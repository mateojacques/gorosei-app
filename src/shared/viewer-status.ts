import type { RegistrationStatus, TournamentStatus } from "./tournament";
import { ROSTER_STARTERS } from "./tournament";

export type StatusStep = {
  id: "riot" | "team" | "payment" | "check_in";
  state: "done" | "pending" | "todo";
  progress?: { have: number; need: number };
};

export type ChecklistInput = {
  riotLinked: boolean;
  free: boolean;
  inPool: boolean;
  registration: { starters: number; paid: number; status: RegistrationStatus } | null;
  tournamentStatus: TournamentStatus;
  checkedIn: boolean;
};

/** The signed-in player's road to the cup: Riot linked, a full team, paid, checked in. */
export function statusChecklist(i: ChecklistInput): StatusStep[] {
  const steps: StatusStep[] = [{ id: "riot", state: i.riotLinked ? "done" : "todo" }];
  const reg = i.registration;

  if (reg) {
    steps.push(
      reg.starters >= ROSTER_STARTERS
        ? { id: "team", state: "done" }
        : { id: "team", state: "pending", progress: { have: reg.starters, need: ROSTER_STARTERS } },
    );
  } else {
    steps.push({ id: "team", state: i.inPool ? "pending" : "todo" });
  }

  if (!i.free) {
    if (reg) {
      steps.push(
        reg.status === "confirmed" || reg.paid >= ROSTER_STARTERS
          ? { id: "payment", state: "done" }
          : { id: "payment", state: "pending", progress: { have: reg.paid, need: ROSTER_STARTERS } },
      );
    } else {
      // The free-agent pool only takes players whose entry is paid.
      steps.push({ id: "payment", state: i.inPool ? "done" : "todo" });
    }
  }

  if (i.tournamentStatus === "check_in" || i.tournamentStatus === "live") {
    steps.push({ id: "check_in", state: i.checkedIn ? "done" : "pending" });
  }
  return steps;
}
