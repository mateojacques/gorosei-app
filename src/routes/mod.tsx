import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { z } from "zod";
import { ConfirmButton, useMatchAction } from "../components/matchday/action";
import { ConsoleQueue } from "../components/matchday/console-queue";
import { LobbyBox } from "../components/matchday/lobby-box";
import { MatchChat } from "../components/matchday/match-chat";
import { MatchHeader } from "../components/matchday/match-header";
import { ReportList } from "../components/matchday/report-form";
import { useRealtime } from "../components/matchday/use-realtime";
import { NotFound } from "../components/site/not-found";
import { Field, FormAlert } from "../components/site/form";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  confirmMatchFn,
  forfeitMatchFn,
  getConsolePage,
  resetMatchFn,
} from "../server/matchday/matchday.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/mod")({
  validateSearch: z.object({ match: z.uuid().optional() }),
  loaderDeps: ({ search }) => ({ match: search.match }),
  loader: ({ deps }) => getConsolePage({ data: { matchId: deps.match } }),
  head: () => ({ meta: [{ title: `${t("console.title")} · ${t("app.name")}` }] }),
  component: ConsolePage,
  notFoundComponent: () => <NotFound message={t("matchday.error.not_found")} />,
});

type Selected = NonNullable<Awaited<ReturnType<typeof getConsolePage>>["selected"]>;

function ConsolePage() {
  const { queue, selected } = Route.useLoaderData();
  const { match: selectedId } = Route.useSearch();
  useRealtime(["console", ...(selectedId ? [`match:${selectedId}`, `chat:${selectedId}`] : [])]);
  return (
    <main className="px-4 py-10 sm:px-8 md:py-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <h1 className="font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase">{t("console.title")}</h1>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
          <ConsoleQueue items={queue} selectedId={selectedId} />
          {selected ? <MatchWork key={selected.match.id} selected={selected} /> : <p className="max-w-prose text-ink-muted">{t("console.pick")}</p>}
        </div>
      </div>
    </main>
  );
}

function MatchWork({ selected }: { selected: Selected }) {
  const { match, tournament, messages } = selected;
  const id = useId();
  const { run, error, notice, pending } = useMatchAction();
  const [score1, setScore1] = useState("0");
  const [score2, setScore2] = useState("0");
  const [a, b] = match.teams;
  const live = match.status !== "completed" && match.status !== "waiting";
  const canConfirm = live && match.reports.length > 0 && match.status !== "disputed";
  const finishedNote = (result: { finished: boolean }) => (result.finished ? t("console.finished") : t("console.done"));
  const max = Math.ceil(match.bestOf / 2);

  return (
    <div className="flex flex-col gap-8">
      <MatchHeader match={match} tournament={tournament} />
      <LobbyBox matchId={match.id} lobby={match.lobby} canCreate={match.status === "open"} />

      <section aria-labelledby={`${id}-r`} className="flex flex-col gap-4">
        <h2 id={`${id}-r`} className="font-display text-2xl font-extrabold uppercase">
          {t("matchday.report.list")}
        </h2>
        {match.reports.length === 0 ? <p className="text-ink-muted">{t("console.noReports")}</p> : <ReportList match={match} />}
        {canConfirm && (
          <Button
            size="lg"
            className="self-start"
            disabled={pending}
            onClick={() => void run(() => confirmMatchFn({ data: { matchId: match.id } }), finishedNote)}
          >
            {t("console.confirm")}
          </Button>
        )}
      </section>

      {live && a && b && (
        <section aria-labelledby={`${id}-o`} className="flex flex-col gap-4">
          <h2 id={`${id}-o`} className="font-display text-2xl font-extrabold uppercase">
            {t("console.override.title")}
          </h2>
          <form
            method="post"
            className="flex max-w-md flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => confirmMatchFn({ data: { matchId: match.id, result: { score1: Number(score1), score2: Number(score2) } } }),
                finishedNote,
              );
            }}
          >
            <div className="grid grid-cols-2 gap-4">
              <Field id={`${id}-s1`} label={t("console.override.score", { team: a.name })}>
                <Input id={`${id}-s1`} type="number" inputMode="numeric" min={0} max={max} value={score1} required onChange={(e) => setScore1(e.target.value)} />
              </Field>
              <Field id={`${id}-s2`} label={t("console.override.score", { team: b.name })}>
                <Input id={`${id}-s2`} type="number" inputMode="numeric" min={0} max={max} value={score2} required onChange={(e) => setScore2(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" variant="secondary" className="self-start" disabled={pending}>
              {t("console.override.apply")}
            </Button>
          </form>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {live &&
          [a, b].map(
            (team) =>
              team && (
                <ConfirmButton
                  key={team.registrationId}
                  label={t("console.forfeit", { team: team.name })}
                  disabled={pending}
                  onConfirm={() => void run(() => forfeitMatchFn({ data: { matchId: match.id, registrationId: team.registrationId } }), finishedNote)}
                />
              ),
          )}
        {match.status !== "waiting" && (
          <ConfirmButton
            label={t("console.reset")}
            disabled={pending}
            onConfirm={() => void run(() => resetMatchFn({ data: { matchId: match.id } }), () => t("console.done"))}
          />
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <FormAlert>{error}</FormAlert>}

      <MatchChat matchId={match.id} messages={messages} />
    </div>
  );
}
