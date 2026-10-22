import { useId } from "react";
import { formatDateTime, t } from "@/shared/i18n";
import { checkInFn, decideShortHandedFn } from "../../server/matchday/matchday.functions";
import { Th } from "../team/team-ui";
import { FormAlert } from "../site/form";
import { Button } from "../ui/button";
import { useMatchAction } from "./action";
import { useRealtime } from "./use-realtime";

type Panel = {
  kind: "check_in";
  view: {
    registrationId: string;
    windowOpensAt: Date;
    windowClosesAt: Date;
    open: boolean;
    players: { userId: string; riotId: string; isSub: boolean; checkedIn: boolean }[];
    checkedInCount: number;
    decision: "play" | "withdraw" | null;
    outcome: "in" | "short_handed" | "withdrawn" | "forfeit";
  };
  userId: string;
  isCaptain: boolean;
  teamName: string;
};

const STARTERS = 5;

/** Check-in for the signed-in player's team: everyone checks themselves in; the captain only decides about gaps. */
export function CheckInPanel({ panel, tournamentId }: { panel: Panel; tournamentId: string }) {
  const id = useId();
  const { view } = panel;
  const { run, error, pending } = useMatchAction();
  useRealtime([`tournament:${tournamentId}`]);
  const me = view.players.find((p) => p.userId === panel.userId);
  const gap = view.checkedInCount < STARTERS && view.checkedInCount >= 3;

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <div>
        <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold uppercase">
          {t("matchday.checkin.title")} · {panel.teamName}
        </h2>
        <p className="mt-1 text-ink-muted">
          {t("matchday.checkin.window", {
            opens: formatDateTime(new Date(view.windowOpensAt)),
            closes: formatDateTime(new Date(view.windowClosesAt)),
          })}
        </p>
      </div>
      <p className="font-display text-xl font-extrabold uppercase tabular-nums">
        {t("matchday.checkin.progress", { count: view.checkedInCount, total: STARTERS })}
      </p>
      <table aria-labelledby={`${id}-h`} className="w-full max-w-xl border-collapse text-left">
        <thead>
          <tr>
            <Th>{t("matchday.stats.col.player")}</Th>
            <Th>{t("tournament.col.status")}</Th>
          </tr>
        </thead>
        <tbody>
          {view.players.map((p) => (
            <tr key={p.userId} className="border-b border-line">
              <td className="py-2 pr-3 font-semibold [overflow-wrap:anywhere]">
                {p.riotId}
                {p.isSub && <span className="ml-2 text-sm font-normal text-ink-muted">{t("matchday.checkin.sub")}</span>}
              </td>
              <td className="py-2 font-display text-lg font-extrabold uppercase">
                {p.checkedIn ? t("matchday.checkin.done") : <span className="text-ink-muted">{t("matchday.checkin.missing")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!view.open && <p className="text-ink-muted">{t("matchday.checkin.closed")}</p>}
      {view.open && me && !me.checkedIn && (
        <Button size="lg" className="self-start" disabled={pending} onClick={() => void run(() => checkInFn({ data: { registrationId: view.registrationId } }))}>
          {t("matchday.checkin.action")}
        </Button>
      )}
      {view.open && me?.checkedIn && <p>{t("matchday.checkin.self")}</p>}
      {panel.isCaptain && view.open && gap && (
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-lg font-extrabold text-ink-muted uppercase">{t("matchday.checkin.decision.title")}</h3>
          <div className="flex flex-wrap gap-3">
            {(["play", "withdraw"] as const).map((decision) => (
              <Button
                key={decision}
                variant="secondary"
                className={view.decision === decision ? "bg-cobalt" : undefined}
                aria-pressed={view.decision === decision}
                disabled={pending}
                onClick={() => void run(() => decideShortHandedFn({ data: { registrationId: view.registrationId, decision } }))}
              >
                {t(`matchday.checkin.decision.${decision}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="max-w-prose">{t(`matchday.checkin.outcome.${view.outcome}`)}</p>
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
