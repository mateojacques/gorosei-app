import { TIME_ZONE } from "./i18n";

const arsFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function formatArs(amount: number): string {
  return `$${arsFormat.format(amount)}`;
}

const cupDayFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "numeric",
});

// "SÁB 7/11": weekday abbreviation uppercased without its trailing dot.
export function formatCupDay(d: Date): string {
  const parts = cupDayFormat.formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = part("weekday").replace(/\.$/, "").toLocaleUpperCase("es-AR");
  return `${weekday} ${part("day")}/${part("month")}`;
}

const cupTimeFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatCupTime(d: Date): string {
  return cupTimeFormat.format(d);
}
