import { Link, createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { FormAlert } from "../components/site/form";
import { SectionHeading, Th, useTeamAction } from "../components/team/team-ui";
import { Button, buttonVariants } from "../components/ui/button";
import { respondToPoolRequestFn } from "../server/pool/pool.functions";
import { cancelRequestFn, getMyTeams, respondToRequestFn } from "../server/teams/teams.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/mis-equipos")({
  loader: () => getMyTeams(),
  head: () => ({ meta: [{ title: `${t("team.mine.title")} · ${t("app.name")}` }] }),
  component: MyTeamsPage,
});

type Pending = { id: string; teamName: string; teamSlug: string; tournamentId: string | null };

/** Pool invites are accepted through the pool code, which also places the player on the roster. */
const respond = (request: Pending, accept: boolean) =>
  request.tournamentId
    ? respondToPoolRequestFn({ data: { requestId: request.id, accept } })
    : respondToRequestFn({ data: { requestId: request.id, accept } });

function MyTeamsPage() {
  const state = Route.useLoaderData();

  if (!state.signedIn) {
    return (
      <Page>
        <p className="mt-6 text-lg">{t("team.signInRequired")}</p>
        <Link to="/ingresar" className={buttonVariants({ size: "lg", className: "mt-6 w-full sm:w-auto" })}>
          {t("auth.title")}
        </Link>
      </Page>
    );
  }

  return (
    <Page>
      <Link to="/equipos/nuevo" className={buttonVariants({ size: "lg", className: "mt-6 w-full sm:w-auto" })}>
        {t("team.create.title")}
      </Link>
      <div className="mt-14 flex flex-col gap-14">
        <TeamsTable teams={state.teams} />
        <InvitesTable invites={state.invites} />
        <RequestsTable requests={state.requests} />
      </div>
    </Page>
  );
}

function TeamsTable({ teams }: { teams: { id: string; slug: string; name: string; tag: string; role: "captain" | "member" }[] }) {
  const headingId = useId();
  return (
    <section>
      <SectionHeading id={headingId}>{t("team.mine.teams")}</SectionHeading>
      {teams.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("team.mine.noTeams")}</p>
      ) : (
        <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr>
              <Th>{t("team.col.team")}</Th>
              <Th>{t("team.col.role")}</Th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id} className="border-b border-line align-top">
                <td className="py-3 pr-3">
                  <TeamLink slug={team.slug} name={team.name} />
                  <span className="ml-2 font-display font-extrabold text-ink-muted">{t("team.tag", { tag: team.tag })}</span>
                </td>
                <td className="py-3">{t(`team.role.${team.role}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function InvitesTable({ invites }: { invites: Pending[] }) {
  const { run, error, pending } = useTeamAction();
  const headingId = useId();
  return (
    <section>
      <SectionHeading id={headingId}>{t("team.mine.invites")}</SectionHeading>
      {invites.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("team.mine.noInvites")}</p>
      ) : (
        <RequestTable headingId={headingId}>
          {invites.map((invite) => (
            <tr key={invite.id} className="border-b border-line align-top">
              <td className="py-3 pr-3">
                <TeamLink slug={invite.teamSlug} name={invite.teamName} />
                {invite.tournamentId && <span className="block text-sm text-ink-muted">{t("pool.kind.invite")}</span>}
              </td>
              <td className="py-2 text-right">
                <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => respond(invite, true))}
                  >
                    {t("team.action.accept")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-0"
                    disabled={pending}
                    onClick={() => run(() => respond(invite, false))}
                  >
                    {t("team.action.decline")}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </RequestTable>
      )}
      {error && (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
    </section>
  );
}

function RequestsTable({ requests }: { requests: Pending[] }) {
  const { run, error, pending } = useTeamAction();
  const headingId = useId();
  return (
    <section>
      <SectionHeading id={headingId}>{t("team.mine.requests")}</SectionHeading>
      {requests.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("team.mine.noRequests")}</p>
      ) : (
        <RequestTable headingId={headingId}>
          {requests.map((request) => (
            <tr key={request.id} className="border-b border-line align-top">
              <td className="py-3 pr-3">
                <TeamLink slug={request.teamSlug} name={request.teamName} />
                {request.tournamentId && <span className="block text-sm text-ink-muted">{t("pool.kind.join_request")}</span>}
              </td>
              <td className="py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0"
                  disabled={pending}
                  onClick={() => run(() => cancelRequestFn({ data: { requestId: request.id } }))}
                >
                  {t("team.action.cancel")}
                </Button>
              </td>
            </tr>
          ))}
        </RequestTable>
      )}
      {error && (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
    </section>
  );
}

function RequestTable({ headingId, children }: { headingId: string; children: ReactNode }) {
  return (
    <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
      <thead>
        <tr>
          <Th>{t("team.col.team")}</Th>
          <Th>
            <span className="sr-only">{t("team.col.actions")}</span>
          </Th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function TeamLink({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      to="/equipos/$slug"
      params={{ slug }}
      className="font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:text-cobalt-light hover:underline"
    >
      {name}
    </Link>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="px-4 py-12 sm:px-8 md:py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.9] font-black uppercase">
          {t("team.mine.title")}
        </h1>
        {children}
      </div>
    </main>
  );
}
