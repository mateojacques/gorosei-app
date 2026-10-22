import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Field } from "../components/site/form";
import { NotFound } from "../components/site/not-found";
import { RosterPicker } from "../components/tournament/roster-picker";
import { Button } from "../components/ui/button";
import { getRegisterPage, registerTeamFn } from "../server/tournaments/tournaments.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/torneos/$slug_/inscribir")({
  loader: ({ params }) => getRegisterPage({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${t("registration.register.title")} · ${loaderData.tournament.title} #${loaderData.tournament.edition}`
          : t("tournament.notFound"),
      },
    ],
  }),
  component: RegisterPage,
  notFoundComponent: () => <NotFound message={t("tournament.notFound")} />,
});

function RegisterPage() {
  const { tournament, signedIn, teams } = Route.useLoaderData();
  return (
    <main className="px-4 py-12 sm:px-8 md:py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div>
          <a href={`/torneos/${tournament.slug}`} className="font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink">
            {tournament.title} #{tournament.edition}
          </a>
          <h1 className="mt-1 font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase">
            {t("registration.register.title")}
          </h1>
        </div>
        {tournament.status !== "registration_open" ? (
          <p className="text-lg">{t("registration.register.closed")}</p>
        ) : !signedIn ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-lg">{t("registration.register.signIn")}</p>
            <Button asChild size="lg">
              <a href="/ingresar">{t("site.signIn")}</a>
            </Button>
          </div>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-lg">{t("registration.register.noTeams")}</p>
            <Button asChild size="lg">
              <a href="/equipos/nuevo">{t("registration.register.createTeam")}</a>
            </Button>
          </div>
        ) : (
          <RegisterForm tournamentId={tournament.id} slug={tournament.slug} maxSubs={tournament.maxSubs} teams={teams} />
        )}
      </div>
    </main>
  );
}

type RegisterTeam = { id: string; slug: string; name: string; members: { userId: string; riotId: string }[] };

function RegisterForm({ tournamentId, slug, maxSubs, teams }: { tournamentId: string; slug: string; maxSubs: number; teams: RegisterTeam[] }) {
  const id = useId();
  const router = useRouter();
  const navigate = useNavigate();
  const [teamId, setTeamId] = useState(teams[0]!.id);
  const team = teams.find((t) => t.id === teamId) ?? teams[0]!;
  return (
    <RosterPicker
      // A new team starts a fresh selection.
      key={team.id}
      members={team.members}
      maxSubs={maxSubs}
      submitLabel={t("registration.register.submit")}
      onSubmit={async (roster) => {
        const result = await registerTeamFn({ data: { tournamentId, teamId: team.id, roster } });
        if (result.ok) {
          await router.invalidate();
          await navigate({ to: "/torneos/$slug/equipos/$teamSlug", params: { slug, teamSlug: team.slug } });
        }
        return result;
      }}
    >
      <Field id={`${id}-team`} label={t("registration.register.team")}>
        <select
          id={`${id}-team`}
          value={team.id}
          onChange={(e) => setTeamId(e.target.value)}
          className="h-11 rounded-[4px] border border-line bg-surface-raised px-3 text-ink"
        >
          {teams.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>
    </RosterPicker>
  );
}
