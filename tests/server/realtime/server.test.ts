import { afterEach, expect, test } from "bun:test";
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
