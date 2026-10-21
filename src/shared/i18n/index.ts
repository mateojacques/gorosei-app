import { esAR } from "./es-AR";

export type MessageKey = keyof typeof esAR;

export const TIME_ZONE = "America/Argentina/Buenos_Aires";

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const message: string = esAR[key];
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
});

export function formatDateTime(d: Date): string {
  return dateTimeFormat.format(d);
}
