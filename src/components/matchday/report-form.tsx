import { useId, useState } from "react";
import { t } from "@/shared/i18n";
import type { MatchCore, MatchView } from "../../server/bracket/bracket";
import { attachRiotMatchIdsFn, reportResultFn } from "../../server/matchday/matchday.functions";
import { Field, FormAlert } from "../site/form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useMatchAction } from "./action";

/** What both captains have reported, in words: waiting, agreeing or in dispute. */
export function reportSummary(match: MatchCore): string | null {
  if (match.status === "completed" || match.status === "waiting") return null;
  if (match.status === "disputed") return t("matchday.report.disputed");
  if (match.status === "reported") return t("matchday.report.agree");
  return match.reports.length === 1 ? t("matchday.report.waitingOther") : null;
}

export function ReportForm({ match, side }: { match: MatchCore; side: 0 | 1 }) {
  const id = useId();
  const mine = match.reports.find((r) => r.registrationId === match.teams[side]?.registrationId);
  const own = mine ? (side === 0 ? mine.score1 : mine.score2) : 0;
  const opponent = mine ? (side === 0 ? mine.score2 : mine.score1) : 0;
  const [ownScore, setOwn] = useState(String(own));
  const [opponentScore, setOpponent] = useState(String(opponent));
  const [screenshot, setScreenshot] = useState(mine?.screenshotUrl ?? "");
  const [riotIds, setRiotIds] = useState(match.riotMatchIds.join(", "));
  const { run, error, notice, pending } = useMatchAction();
  const max = Math.ceil(match.bestOf / 2);

  async function submit() {
    const ids = riotIds
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const ok = await run(
      () =>
        reportResultFn({
          data: {
            matchId: match.id,
            report: { own: Number(ownScore), opponent: Number(opponentScore), screenshotUrl: screenshot.trim() || null, riotMatchIds: ids },
          },
        }),
      () => t("matchday.report.sent"),
    );
    // Stats are pulled once per ID; a failure here must not undo the report.
    if (ok && ids.length > 0) await attachRiotMatchIdsFn({ data: { matchId: match.id, riotMatchIds: ids } }).catch(() => undefined);
  }

  return (
    <form
      method="post"
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field id={`${id}-own`} label={t("matchday.report.own")}>
          <Input id={`${id}-own`} type="number" inputMode="numeric" min={0} max={max} value={ownScore} required onChange={(e) => setOwn(e.target.value)} />
        </Field>
        <Field id={`${id}-opp`} label={t("matchday.report.opponent")}>
          <Input id={`${id}-opp`} type="number" inputMode="numeric" min={0} max={max} value={opponentScore} required onChange={(e) => setOpponent(e.target.value)} />
        </Field>
      </div>
      <Field id={`${id}-shot`} label={t("matchday.report.screenshot")}>
        <Input id={`${id}-shot`} type="url" inputMode="url" value={screenshot} onChange={(e) => setScreenshot(e.target.value)} />
      </Field>
      <Field id={`${id}-ids`} label={t("matchday.report.riotIds")}>
        <Input id={`${id}-ids`} value={riotIds} aria-describedby={`${id}-ids-hint`} onChange={(e) => setRiotIds(e.target.value)} />
        <p id={`${id}-ids-hint`} className="text-sm text-ink-muted">
          {t("matchday.report.riotIdsHint")}
        </p>
      </Field>
      <Button type="submit" size="lg" className="self-start" disabled={pending}>
        {mine ? t("matchday.report.update") : t("matchday.report.submit")}
      </Button>
      {notice && <p role="status">{notice}</p>}
      {error && <FormAlert>{error}</FormAlert>}
    </form>
  );
}

/** The captains' reports side by side, for participants and moderators. */
export function ReportList({ match }: { match: MatchCore }) {
  if (match.reports.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-lg">
      {match.reports.map((r) => {
        const team = match.teams.find((x) => x?.registrationId === r.registrationId);
        return (
          <li key={r.registrationId} className="tabular-nums">
            {t("matchday.report.entry", { team: team?.name ?? "", score1: r.score1, score2: r.score2 })}
            {r.screenshotUrl && (
              <>
                {" · "}
                <a href={r.screenshotUrl} rel="noopener noreferrer nofollow" target="_blank" className="text-cobalt-light underline underline-offset-4">
                  {t("matchday.report.screenshotLink")}
                </a>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
