import { checkInWindow } from "./check-in";
import type { TournamentStatus } from "./tournament";

export type TournamentStage = "before" | "live" | "after";

export function tournamentStage(status: TournamentStatus): TournamentStage | null {
  switch (status) {
    case "draft":
      return null;
    case "registration_open":
    case "registration_closed":
    case "check_in":
      return "before";
    case "live":
      return "live";
    case "finished":
    case "cancelled":
      return "after";
  }
}

export type ScheduleRow = { key: "registrationCloses" | "checkInOpens" | "checkInCloses" | "starts"; at: Date };

export function tournamentSchedule(t: { registrationClosesAt: Date; startsAt: Date }): ScheduleRow[] {
  const window = checkInWindow(t.startsAt);
  const rows: ScheduleRow[] = [
    { key: "registrationCloses", at: t.registrationClosesAt },
    { key: "checkInOpens", at: window.opensAt },
    { key: "checkInCloses", at: window.closesAt },
    { key: "starts", at: t.startsAt },
  ];
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}
