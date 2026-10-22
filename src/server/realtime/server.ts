import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";
import type { SessionUser } from "../auth";
import type { Db } from "../db/client";
import { canAccessMatchChat } from "../matchday/chat";
import { isModerator } from "../../shared/match";
import { subscribe } from "./hub";

export type ChannelAccess = (user: SessionUser | null, channel: string) => Promise<boolean>;

const MAX_CHANNEL_LENGTH = 100;
const MAX_SUBSCRIPTIONS = 50;

export function startRealtimeServer(opts: {
  port: number;
  authenticate: (headers: Headers) => Promise<SessionUser | null>;
  canSubscribe: ChannelAccess;
  /** Browser origins allowed to connect; a request with no Origin header (not a browser) is always allowed. */
  allowedOrigins?: string[];
}): { close(): Promise<void>; readonly port: number; ready: Promise<void> } {
  const http = createServer((_req, res) => {
    res.writeHead(426).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (request, socket, head) => {
    // The session cookie authenticates the upgrade, so another site must not be able to open a socket as the visitor.
    const origin = request.headers.origin;
    if (opts.allowedOrigins && origin && !opts.allowedOrigins.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    // The session is read once, on the upgrade.
    opts
      .authenticate(headers)
      .catch(() => null)
      .then((user) => wss.handleUpgrade(request, socket, head, (ws) => handleConnection(ws, user)))
      .catch(() => socket.destroy());
  });

  function handleConnection(ws: WebSocket, user: SessionUser | null) {
    const subscriptions = new Map<string, () => void>();
    const send = (message: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    ws.on("message", async (raw) => {
      let message: { type?: unknown; channel?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const channel = message.channel;
      if (typeof channel !== "string" || channel.length === 0 || channel.length > MAX_CHANNEL_LENGTH) return;
      if (message.type === "unsubscribe") {
        subscriptions.get(channel)?.();
        subscriptions.delete(channel);
      } else if (message.type === "subscribe") {
        if (subscriptions.has(channel)) return;
        const allowed = subscriptions.size < MAX_SUBSCRIPTIONS && (await opts.canSubscribe(user, channel).catch(() => false));
        if (!allowed) return send({ type: "denied", channel });
        // Re-check: the socket may have closed or subscribed meanwhile.
        if (ws.readyState !== ws.OPEN || subscriptions.has(channel)) return;
        subscriptions.set(
          channel,
          subscribe(channel, (event) => send({ channel: event.channel, type: event.type, data: event.data })),
        );
        send({ type: "subscribed", channel });
      }
    });
    ws.on("close", () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    });
    ws.on("error", () => ws.terminate());
  }

  const ready = new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, resolve);
  });
  ready.catch((error) => console.error("[realtime] failed to start", error));

  return {
    ready,
    get port() {
      return (http.address() as AddressInfo | null)?.port ?? opts.port;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

/** Public channels are open to everyone; chat to the two teams and moderators; the console to moderators. */
export function canSubscribe(db: Db): ChannelAccess {
  return async (user, channel) => {
    const [kind, id] = channel.split(":", 2) as [string, string | undefined];
    if (kind === "tournament" || kind === "match") return !!id;
    if (channel === "console") return !!user && isModerator(user.role);
    if (kind === "chat" && id) return !!user && canAccessMatchChat(db, user, id);
    return false;
  };
}
