import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useId } from "react";
import { CaptionBar } from "../components/cup/caption-bar";
import { NotFound } from "../components/site/not-found";
import { Field, FormAlert } from "../components/site/form";
import { Placement } from "../components/team/placement";
import { SectionHeading, Th, useTeamAction } from "../components/team/team-ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  cancelRequestFn,
  getTeamPage,
  inviteByRiotIdFn,
  leaveTeamFn,
  removeMemberFn,
  requestToJoinFn,
  respondToRequestFn,
  transferCaptainFn,
} from "../server/teams/teams.functions";
import { renameTeamFn, respondToPoolRequestFn } from "../server/pool/pool.functions";
import { formatLongDate } from "../shared/format";
import { t } from "../shared/i18n";
import { formatRank } from "../shared/rank";
import { formatRiotId, riotIdToSlug } from "../shared/riot-id";

export const Route = createFileRoute("/equipos/$slug")({
  loader: ({ params }) => getTeamPage({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: `${t("team.error.team_not_found")} · ${t("app.name")}` }] };
    const { name, tag } = loaderData.team;
    return {
      meta: [
        { title: `${name} ${t("team.tag", { tag })} · ${t("app.name")}` },
        { name: "description", content: t("team.metaDescription", { team: name, tag }) },
      ],
    };
  },
  component: TeamPage,
  notFoundComponent: () => <NotFound message={t("team.error.team_not_found")} />,
});

type TeamPageData = Awaited<ReturnType<typeof getTeamPage>>;

/** Pool join requests are accepted through the pool code, which also puts the player on the roster. */
const respond = (request: { id: string; tournamentId: string | null }, accept: boolean) =>
  request.tournamentId
    ? respondToPoolRequestFn({ data: { requestId: request.id, accept } })
    : respondToRequestFn({ data: { requestId: request.id, accept } });
function TeamPage() {
  const { team, history, viewer, pendingRequests } = Route.useLoaderData();
  const isCaptain = viewer?.role === "captain";
  const count = team.members.length;
  return (
    <main>
      <section className="stage relative isolate overflow-hidden px-4 pt-10 pb-10 sm:px-8 md:pt-16 md:pb-14">
        <div className="mx-auto max-w-4xl">
          <h1 className="font-display text-[clamp(2.75rem,13vw,5.5rem)] leading-[0.9] font-black tracking-[-0.01em] uppercase [overflow-wrap:anywhere]">
            {team.name}
          </h1>
          <CaptionBar block={t("team.tag", { tag: team.tag })} className="mt-5">
            {t(count === 1 ? "team.memberCount" : "team.memberCount_other", { count })}
          </CaptionBar>
          {viewer && viewer.role === null && viewer.linked && (
            <JoinAction teamId={team.id} joinRequestId={viewer.joinRequestId} inviteId={viewer.inviteId} />
          )}
        </div>
      </section>

      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto flex max-w-4xl flex-col gap-14">
          <Roster team={team} isCaptain={isCaptain} />
          <History items={history} />
          {isCaptain && team.autoFormed && <KeepTeam teamId={team.id} name={team.name} tag={team.tag} />}
          {isCaptain && <Invite teamId={team.id} />}
          {isCaptain && <PendingRequests requests={pendingRequests} />}
          {viewer?.role === "member" && <LeaveAction teamId={team.id} teamName={team.name} />}
        </div>
      </div>
    </main>
  );
}

function History({ items }: { items: TeamPageData["history"] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <SectionHeading id={headingId}>{t("team.history")}</SectionHeading>
      {items.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("team.noHistory")}</p>
      ) : (
        <ul className="mt-3 border-b border-line">
          {items.map((item) => (
            <li key={item.slug} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3">
              <a
                href={`/torneos/${item.slug}`}
                className="font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:text-cobalt-light hover:underline"
              >
                {item.title} #{item.edition}
              </a>
              <span className="flex items-baseline gap-4">
                <Placement rank={item.placement} status={item.status} />
                <span className="text-ink-muted">{formatLongDate(new Date(item.startsAt))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JoinAction({
  teamId,
  joinRequestId,
  inviteId,
}: {
  teamId: string;
  joinRequestId: string | null;
  inviteId: string | null;
}) {
  const { run, error, pending } = useTeamAction();
  return (
    <div className="mt-8 flex flex-col items-start gap-4">
      {inviteId ? (
        <>
          <p role="status" className="text-lg">
            {t("team.invitePending")}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              size="lg"
              disabled={pending}
              onClick={() => run(() => respondToRequestFn({ data: { requestId: inviteId, accept: true } }))}
            >
              {t("team.action.accept")}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              className="px-0"
              onClick={() => run(() => respondToRequestFn({ data: { requestId: inviteId, accept: false } }))}
            >
              {t("team.action.decline")}
            </Button>
          </div>
        </>
      ) : joinRequestId ? (
        <>
          <p role="status" className="text-lg">
            {t("team.requestPending")}
          </p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => cancelRequestFn({ data: { requestId: joinRequestId } }))}
          >
            {t("team.action.cancelRequest")}
          </Button>
        </>
      ) : (
        <Button size="lg" disabled={pending} onClick={() => run(() => requestToJoinFn({ data: { teamId } }))}>
          {t("team.action.requestToJoin")}
        </Button>
      )}
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

function Roster({ team, isCaptain }: { team: TeamPageData["team"]; isCaptain: boolean }) {
  const { run, error, pending } = useTeamAction();
  const headingId = useId();
  return (
    <section>
      <SectionHeading id={headingId}>{t("team.roster")}</SectionHeading>
      <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
        <thead>
          <tr>
            <Th>{t("team.col.player")}</Th>
            <Th>{t("team.col.rank")}</Th>
            {isCaptain && (
              <Th>
                <span className="sr-only">{t("team.col.actions")}</span>
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {team.members.map((member) => {
            const riotId = formatRiotId(member);
            const isMemberRow = member.role === "member";
            return (
              <tr key={member.userId} className="border-b border-line align-top">
                <td className="py-3 pr-3">
                  <a
                    href={`/jugador/${riotIdToSlug(member)}`}
                    className="font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:text-cobalt-light hover:underline"
                  >
                    {riotId}
                  </a>
                  <span className="block text-sm text-ink-muted">{t(`team.role.${member.role}`)}</span>
                </td>
                <td className="py-3 pr-3 font-display text-lg leading-tight font-extrabold uppercase">
                  {formatRank(member.currentRank)}
                </td>
                {isCaptain && (
                  <td className="py-2 text-right">
                    {isMemberRow && (
                      <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-0"
                          disabled={pending}
                          onClick={() =>
                            confirm(t("team.confirm.makeCaptain", { riotId })) &&
                            run(() => transferCaptainFn({ data: { teamId: team.id, userId: member.userId } }))
                          }
                        >
                          {t("team.action.makeCaptain")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-0"
                          disabled={pending}
                          onClick={() =>
                            confirm(t("team.confirm.remove", { riotId })) &&
                            run(() => removeMemberFn({ data: { teamId: team.id, userId: member.userId } }))
                          }
                        >
                          {t("team.action.remove")}
                        </Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
    </section>
  );
}

function KeepTeam({ teamId, name, tag }: { teamId: string; name: string; tag: string }) {
  const { run, error, pending } = useTeamAction();
  const id = useId();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(() => renameTeamFn({ data: { teamId, name: String(data.get("name")), tag: String(data.get("tag")) } }));
  }
  return (
    <section className="max-w-md">
      <SectionHeading>{t("team.autoFormed.title")}</SectionHeading>
      <p className="mt-2 text-ink-muted">{t("team.autoFormed.body")}</p>
      <form method="post" onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <Field id={`${id}-name`} label={t("team.autoFormed.name")}>
          <Input id={`${id}-name`} name="name" required defaultValue={name} autoComplete="off" />
        </Field>
        <Field id={`${id}-tag`} label={t("team.autoFormed.tag")}>
          <Input id={`${id}-tag`} name="tag" required defaultValue={tag} autoComplete="off" />
        </Field>
        {error && <FormAlert>{error}</FormAlert>}
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {t("team.autoFormed.submit")}
        </Button>
      </form>
    </section>
  );
}

function Invite({ teamId }: { teamId: string }) {
  const { run, error, pending } = useTeamAction();
  const id = useId();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const riotId = String(new FormData(form).get("riotId"));
    if (await run(() => inviteByRiotIdFn({ data: { teamId, riotId } }))) form.reset();
  }
  return (
    <section className="max-w-md">
      <SectionHeading>{t("team.invite.title")}</SectionHeading>
      <form method="post" onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <Field id={`${id}-riot-id`} label={t("team.invite.riotId")}>
          <Input
            id={`${id}-riot-id`}
            name="riotId"
            required
            autoComplete="off"
            placeholder={t("team.invite.placeholder")}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        {error && <FormAlert>{error}</FormAlert>}
        <Button type="submit" disabled={pending} className="self-start">
          {t("team.invite.submit")}
        </Button>
      </form>
    </section>
  );
}

function PendingRequests({ requests }: { requests: TeamPageData["pendingRequests"] }) {
  const { run, error, pending } = useTeamAction();
  const headingId = useId();
  return (
    <section>
      <SectionHeading id={headingId}>{t("team.pending.title")}</SectionHeading>
      {requests.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("team.pending.empty")}</p>
      ) : (
        <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr>
              <Th>{t("team.col.player")}</Th>
              <Th>
                <span className="sr-only">{t("team.col.actions")}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="border-b border-line align-top">
                <td className="py-3 pr-3">
                  <span className="font-semibold [overflow-wrap:anywhere]">{formatRiotId(request)}</span>
                  <span className="block text-sm text-ink-muted">{t(`team.kind.${request.kind}`)}</span>
                </td>
                <td className="py-2 text-right">
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                    {request.kind === "join_request" ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => respond(request, true))}
                        >
                          {t("team.action.accept")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-0"
                          disabled={pending}
                          onClick={() => run(() => respond(request, false))}
                        >
                          {t("team.action.decline")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-0"
                        disabled={pending}
                        onClick={() => run(() => cancelRequestFn({ data: { requestId: request.id } }))}
                      >
                        {t("team.action.cancel")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
    </section>
  );
}

function LeaveAction({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { run, error, pending } = useTeamAction();
  return (
    <section className="flex flex-col items-start gap-4 border-t border-line pt-6">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => confirm(t("team.confirm.leave", { team: teamName })) && run(() => leaveTeamFn({ data: { teamId } }))}
      >
        {t("team.action.leave")}
      </Button>
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
