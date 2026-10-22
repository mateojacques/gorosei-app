import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 15_000;
const SETTLE_MS = 150;

export type RealtimeMessage = { channel: string; type: string; data?: unknown };

/**
 * Keeps the page in step with the server. Events say "something changed" and the page reloads its data;
 * while the socket is down a 15 s poll does the same, so the page works with or without WebSockets.
 */
export function useRealtime(channels: string[], onEvent?: (message: RealtimeMessage) => void): void {
  const router = useRouter();
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = channels.join("|");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      clearTimeout(settle);
      settle = setTimeout(() => void router.invalidate(), SETTLE_MS);
    };
    const startPolling = () => {
      poll ??= setInterval(() => void router.invalidate(), POLL_MS);
    };
    const stopPolling = () => {
      clearInterval(poll);
      poll = undefined;
    };

    function connect() {
      if (closed) return;
      try {
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        socket = new WebSocket(`${scheme}://${location.host}/realtime`);
      } catch {
        startPolling();
        return;
      }
      socket.onopen = () => {
        attempt = 0;
        stopPolling();
        for (const channel of key.split("|").filter(Boolean)) socket?.send(JSON.stringify({ type: "subscribe", channel }));
        // Anything published while the socket was down is picked up here.
        refresh();
      };
      socket.onmessage = (event) => {
        let message: RealtimeMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "subscribed" || message.type === "denied") return;
        if (handler.current) handler.current(message);
        else refresh();
      };
      socket.onclose = () => {
        socket = null;
        if (closed) return;
        startPolling();
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, MAX_BACKOFF_MS));
      };
      socket.onerror = () => socket?.close();
    }

    startPolling();
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(settle);
      stopPolling();
      socket?.close();
    };
  }, [key, router]);
}
