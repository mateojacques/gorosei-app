// Argentina has no DST: ART is a fixed UTC−03:00, so the conversion is a plain offset.
const ART_OFFSET = "-03:00";
const ART_OFFSET_MS = 3 * 60 * 60 * 1000;
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Reads an `<input type="datetime-local">` value as ART: "2026-11-07T18:00" → 2026-11-07T21:00:00Z. */
export function fromArtDateTimeLocal(value: string): Date {
  if (!DATETIME_LOCAL.test(value)) return new Date(Number.NaN);
  return new Date(`${value}:00${ART_OFFSET}`);
}

/** The inverse: a UTC instant as an ART `datetime-local` value. */
export function toArtDateTimeLocal(d: Date): string {
  return new Date(d.getTime() - ART_OFFSET_MS).toISOString().slice(0, 16);
}
