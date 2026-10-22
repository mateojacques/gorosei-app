export const CHECK_IN_OPENS_BEFORE_MINUTES = 60;
export const CHECK_IN_CLOSES_BEFORE_MINUTES = 10;
export const MIN_SHORT_HANDED = 3;
/** A captain missing players is reminded this long before check-in closes. */
export const CHECK_IN_REMINDER_BEFORE_CLOSE_MINUTES = 15;

const MINUTE_MS = 60_000;

export function checkInWindow(startsAt: Date): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(startsAt.getTime() - CHECK_IN_OPENS_BEFORE_MINUTES * MINUTE_MS),
    closesAt: new Date(startsAt.getTime() - CHECK_IN_CLOSES_BEFORE_MINUTES * MINUTE_MS),
  };
}

export type ShortHandedDecision = "play" | "withdraw";
export type CheckInOutcome = "in" | "short_handed" | "withdrawn" | "forfeit";

export function checkInOutcome(checkedIn: number, decision: ShortHandedDecision | null): CheckInOutcome {
  if (checkedIn >= 5) return "in";
  if (checkedIn < MIN_SHORT_HANDED) return "forfeit";
  return decision === "withdraw" ? "withdrawn" : "short_handed";
}
