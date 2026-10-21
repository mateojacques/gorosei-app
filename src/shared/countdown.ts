export type Countdown = { days: number; hours: number; minutes: number; seconds: number };

// Null once the start time is reached, so callers switch to the "en juego" state instead of going negative.
export function getCountdown(now: Date, startsAt: Date): Countdown | null {
  const total = Math.floor((startsAt.getTime() - now.getTime()) / 1000);
  if (total <= 0) return null;
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatCountdown(c: Countdown): string {
  return `${c.days}d ${pad(c.hours)}h ${pad(c.minutes)}m`;
}
