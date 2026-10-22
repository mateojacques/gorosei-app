import { afterEach, expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import WebSocket from "ws";
import type { SessionUser } from "../../../src/server/auth";
import { publish } from "../../../src/server/realtime/hub";
import { startRealtimeServer } from "../../../src/server/realtime/server";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const mod: SessionUser = { id: "m", name: "m", role: "moderator" };

async function start(user: SessionUser | null = null) {
  const server = startRealtimeServer({
    port: 0,
    authenticate: async () => user,
    canSubscribe: async (u, channel) => !channel.startsWith("console") || u?.role === "moderator",
  });
  await server.ready;
  closers.push(() => server.close());
  const ws = new WebSocket(`ws://localhost:${server.port}/`);
  const messages: any[] = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => (ws.once("open", resolve), ws.once("error", reject)));
  closers.push(async () => ws.terminate());
  const waitFor = async (predicate: (m: any) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`message not received: ${JSON.stringify(messages)}`);
  };
  return { server, ws, messages, waitFor };
}

test("a public channel subscription receives published events", async () => {
  const { ws, waitFor } = await start();
  ws.send(JSON.stringify({ type: "subscribe", channel: "match:abc" }));
  await waitFor((m) => m.type === "subscribed");
  publish({ channel: "match:abc", type: "updated", data: { n: 1 } });
  expect(await waitFor((m) => m.type === "updated")).toEqual({ channel: "match:abc", type: "updated", data: { n: 1 } });
});

test("a private channel without access is denied and never delivers", async () => {
  const { ws, messages, waitFor } = await start(null);
  ws.send(JSON.stringify({ type: "subscribe", channel: "console" }));
  await waitFor((m) => m.type === "denied");
  publish({ channel: "console", type: "secret" });
  await new Promise((r) => setTimeout(r, 50));
  expect(messages.some((m) => m.type === "secret")).toBe(false);
});

test("a moderator can subscribe to the console", async () => {
  const { ws, waitFor } = await start(mod);
  ws.send(JSON.stringify({ type: "subscribe", channel: "console" }));
  await waitFor((m) => m.type === "subscribed");
  publish({ channel: "console", type: "queue" });
  await waitFor((m) => m.type === "queue");
});

test("unsubscribing stops delivery and malformed JSON does not kill the connection", async () => {
  const { ws, messages, waitFor } = await start();
  ws.send("not json{");
  ws.send(JSON.stringify({ type: "subscribe", channel: "tournament:1" }));
  await waitFor((m) => m.type === "subscribed");
  ws.send(JSON.stringify({ type: "unsubscribe", channel: "tournament:1" }));
  await new Promise((r) => setTimeout(r, 50));
  publish({ channel: "tournament:1", type: "late" });
  await new Promise((r) => setTimeout(r, 50));
  expect(messages.some((m) => m.type === "late")).toBe(false);
  expect(ws.readyState).toBe(WebSocket.OPEN);
});

test("close() drops connections", async () => {
  const { server, ws } = await start();
  const closed = new Promise((resolve) => ws.once("close", resolve));
  await server.close();
  await closed;
  expect(ws.readyState).toBe(WebSocket.CLOSED);
});

/** Raw upgrade request, so the Origin header is exactly what the test says. */
async function upgradeStatus(port: number, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      port,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("0123456789abcdef").toString("base64"),
        ...(origin ? { Origin: origin } : {}),
      },
    });
    req.on("upgrade", (res, socket) => (socket.destroy(), resolve(res.statusCode ?? 0)));
    req.on("response", (res) => resolve(res.statusCode ?? 0));
    req.on("error", () => resolve(0));
    req.end();
  });
}

test("a cross-site origin cannot open a connection, while the site's own origin and non-browser clients can", async () => {
  const server = startRealtimeServer({
    port: 0,
    authenticate: async () => mod,
    canSubscribe: async () => true,
    allowedOrigins: ["https://gorosei.example"],
  });
  await server.ready;
  closers.push(() => server.close());
  expect(await upgradeStatus(server.port, "https://evil.example")).not.toBe(101);
  expect(await upgradeStatus(server.port, "https://gorosei.example")).toBe(101);
  expect(await upgradeStatus(server.port)).toBe(101);
});
