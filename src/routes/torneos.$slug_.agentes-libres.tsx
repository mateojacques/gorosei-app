import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { z } from "zod";
import { OpenTeamsTable } from "../components/pool/open-teams";
import { PoolTable } from "../components/pool/pool-table";
import { usePoolAction } from "../components/pool/pool-ui";
import { RolePicker, formatRoles } from "../components/pool/role-picker";
import { FormAlert, Field } from "../components/site/form";
import { NotFound } from "../components/site/not-found";
import { SectionHeading, Th } from "../components/team/team-ui";
import { FailureList } from "../components/tournament/failure-list";
import { TournamentStatusTag } from "../components/tournament/registration-status";
import { Button } from "../components/ui/button";
import {
  enterPoolFn,
  getPoolPageFn,
  leavePoolFn,
  recruitFromPoolFn,
  requestFromPoolFn,
  respondToPoolRequestFn,
} from "../server/pool/pool.functions";
import { cancelRequestFn } from "../server/teams/teams.functions";
import { formatArs } from "../shared/format";
import { formatFailure } from "../shared/eligibility";
import { t } from "../shared/i18n";
import { ROLES, type Role } from "../shared/pool";
import { TIERS } from "../shared/rank";
import { NOINDEX_META } from "../shared/seo";

// The GET filter form sends empty values for "any"; those read as no filter.
const searchSchema = z.object({
  role: z.enum(ROLES).optional().catch(undefined),
  minTier: z.enum(TIERS).optional().catch(undefined),
  maxTier: z.enum(TIERS).optional().catch(undefined),
});

export const Route = createFileRoute("/torneos/$slug_/agentes-libres")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getPoolPageFn({ data: { slug: params.slug, filter: deps } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${t("pool.title")} · ${loaderData.tournament.title} #${loaderData.tournament.edition}`
          : t("tournament.notFound"),
      },
      NOINDEX_META,
      ...(loaderData
        ? [{ name: "description", content: t("pool.metaDescription", { title: loaderData.tournament.title, edition: loaderData.tournament.edition }) }]
        : []),
    ],
  }),
  component: PoolPage,
  notFoundComponent: () => <NotFound message={t("tournament.notFound")} />,
});

type PageData = Awaited<ReturnType<typeof getPoolPageFn>>;

function PoolPage() {
  const page = Route.useLoaderData();
  const { tournament, viewer, captain } = page;
  return (
    <main className="px-4 py-12 sm:px-8 md:py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-12">
        <header>
          <TournamentStatusTag status={tournament.status} />
          <a
            href={`/torneos/${tournament.slug}`}
            className="mt-5 block font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink"
          >
            {tournament.title} #{tournament.edition}
          </a>
          <h1 className="mt-1 font-display text-[clamp(2.5rem,11vw,4.5rem)] leading-[0.9] font-black uppercase">{t("pool.title")}</h1>
          <p className="mt-3 font-display text-lg font-extrabold uppercase tabular-nums">
            {t(tournament.poolCount === 1 ? "pool.count" : "pool.count_other", { count: tournament.poolCount })}
          </p>
        </header>
        <ViewerPanel tournament={tournament} viewer={viewer} />
        {captain && <CaptainPanel captain={captain} />}
      </div>
    </main>
  );
}

function ViewerPanel({ tournament, viewer }: { tournament: PageData["tournament"]; viewer: PageData["viewer"] }) {
  switch (viewer.kind) {
    case "signed_out":
      return (
        <Notice message={t("pool.signedOut")}>
          <Button asChild size="lg">
            <a href="/ingresar">{t("site.signIn")}</a>
          </Button>
        </Notice>
      );
    case "no_riot":
      return (
        <Notice message={t("pool.noRiot")}>
          <Button asChild size="lg">
            <a href="/vincular-riot">{t("site.linkRiot")}</a>
          </Button>
        </Notice>
      );
    case "closed":
      return <Notice message={t("pool.closed")} />;
    case "unplaced":
      return <Notice message={t("pool.unplaced")} />;
    case "unpaid":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeading>{t("pool.unpaid.title")}</SectionHeading>
          <p className="max-w-prose">{t("pool.unpaid.body", { fee: formatArs(tournament.entryFeeArs) })}</p>
          {tournament.paymentInstructions && (
            <div className="border-t border-line pt-4">
              <h3 className="font-display text-lg font-extrabold text-ink-muted uppercase">{t("pool.howToPay")}</h3>
              <p className="mt-2 whitespace-pre-line">{tournament.paymentInstructions}</p>
            </div>
          )}
        </section>
      );
    case "ineligible":
      return (
        <section role="alert" className="border border-line bg-surface-raised px-3 py-2.5 text-sm">
          <p className="font-semibold">{t("pool.ineligible")}</p>
          <ul className="mt-1 list-disc pl-5">
            {viewer.failures.map((f, i) => (
              <li key={`${f.ruleId}-${i}`}>{formatFailure(f)}</li>
            ))}
          </ul>
        </section>
      );
    case "can_enter":
      return <EntryForm tournamentId={tournament.id} />;
    case "placed":
      return (
        <section className="flex flex-col gap-2">
          <SectionHeading>{t("pool.placed.title")}</SectionHeading>
          <p>
            {t("pool.placed.body", { team: viewer.team.name, captain: viewer.team.captainRiotId })}{" "}
            <a href={`/equipos/${viewer.team.slug}`} className="font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink">
              {viewer.team.name}
            </a>
          </p>
          {viewer.team.mates.length > 0 && <p className="text-ink-muted [overflow-wrap:anywhere]">{t("pool.placed.mates", { mates: viewer.team.mates.join(", ") })}</p>}
          {viewer.team.autoFormed && <p>{t("pool.placed.auto")}</p>}
        </section>
      );
    case "in_pool":
      return <InPool tournamentId={tournament.id} viewer={viewer} />;
  }
}

function Notice({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="max-w-prose text-lg">{message}</p>
      {children}
    </div>
  );
}

function EntryForm({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial?: { roles: Role[]; autoPlace: boolean };
}) {
  const id = useId();
  const editing = !!initial;
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? []);
  const [autoPlace, setAutoPlace] = useState(initial?.autoPlace ?? true);
  const { run, error, failures, pending } = usePoolAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() => enterPoolFn({ data: { tournamentId, entry: { roles, autoPlace } } }));
  }
  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-5">
      <SectionHeading>{editing ? t("pool.edit.title") : t("pool.enter.title")}</SectionHeading>
      <p className="max-w-prose text-ink-muted">{t("pool.enter.help")}</p>
      <RolePicker value={roles} onChange={setRoles} />
      <Field id={`${id}-auto`} label={t("pool.autoPlace")}>
        <input
          id={`${id}-auto`}
          type="checkbox"
          className="size-5 accent-cobalt-light"
          checked={autoPlace}
          onChange={(e) => setAutoPlace(e.target.checked)}
        />
        <p className="max-w-prose text-sm text-ink-muted">{t("pool.autoPlace.hint")}</p>
      </Field>
      {failures.length > 0 && <FailureList failures={failures} />}
      {error && <FormAlert>{error}</FormAlert>}
      {editing ? (
        <Button type="submit" variant="secondary" disabled={pending || roles.length === 0} className="self-start">
          {t("pool.update.submit")}
        </Button>
      ) : (
        <Button type="submit" size="lg" disabled={pending || roles.length === 0} className="self-start">
          {t("pool.enter.submit")}
        </Button>
      )}
    </form>
  );
}

type InPoolViewer = Extract<PageData["viewer"], { kind: "in_pool" }>;

function InPool({ tournamentId, viewer }: { tournamentId: string; viewer: InPoolViewer }) {
  const { run, error, failures, pending } = usePoolAction();
  const teamsHeading = useId();
  const invitesHeading = useId();
  const requestsHeading = useId();
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-2">
        <p className="text-lg font-semibold" role="status">
          {t("pool.inPool")} {formatRoles(viewer.entry.roles)}
        </p>
        <p className="text-ink-muted">{t(viewer.entry.autoPlace ? "pool.inPool.autoOn" : "pool.inPool.autoOff")}</p>
        {error && <FormAlert>{error}</FormAlert>}
        {failures.length > 0 && <FailureList failures={failures.map((f) => f)} />}
      </section>

      <section>
        <SectionHeading id={invitesHeading}>{t("pool.invites.title")}</SectionHeading>
        {viewer.invites.length === 0 ? (
          <p className="mt-2 text-ink-muted">{t("pool.invites.empty")}</p>
        ) : (
          <RequestRows headingId={invitesHeading}>
            {viewer.invites.map((invite) => (
              <tr key={invite.requestId} className="border-b border-line align-top">
                <td className="py-3 pr-3 font-semibold [overflow-wrap:anywhere]">{invite.teamName}</td>
                <td className="py-2 text-right">
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => respondToPoolRequestFn({ data: { requestId: invite.requestId, accept: true } }))}
                    >
                      {t("pool.action.accept")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-0"
                      disabled={pending}
                      onClick={() => run(() => respondToPoolRequestFn({ data: { requestId: invite.requestId, accept: false } }))}
                    >
                      {t("pool.action.decline")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </RequestRows>
        )}
      </section>

      <section>
        <SectionHeading id={teamsHeading}>{t("pool.teams.title")}</SectionHeading>
        <OpenTeamsTable
          headingId={teamsHeading}
          teams={viewer.openTeams}
          disabled={pending}
          onRequest={(registrationId) => run(() => requestFromPoolFn({ data: { registrationId } }))}
        />
      </section>

      <section>
        <SectionHeading id={requestsHeading}>{t("pool.requests.title")}</SectionHeading>
        {viewer.requests.length === 0 ? (
          <p className="mt-2 text-ink-muted">{t("pool.requests.empty")}</p>
        ) : (
          <RequestRows headingId={requestsHeading}>
            {viewer.requests.map((request) => (
              <tr key={request.requestId} className="border-b border-line align-top">
                <td className="py-3 pr-3 font-semibold [overflow-wrap:anywhere]">{request.teamName}</td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-0"
                    disabled={pending}
                    onClick={async () => {
                      await run(async () => {
                        const result = await cancelRequestFn({ data: { requestId: request.requestId } });
                        return result.ok ? result : { ok: false as const, reason: "not_pending" as const };
                      });
                    }}
                  >
                    {t("pool.action.cancel")}
                  </Button>
                </td>
              </tr>
            ))}
          </RequestRows>
        )}
      </section>

      <EntryForm tournamentId={tournamentId} initial={viewer.entry} />
      <Button
        variant="ghost"
        className="self-start px-0"
        disabled={pending}
        onClick={() => run(() => leavePoolFn({ data: { tournamentId } }))}
      >
        {t("pool.leave")}
      </Button>
    </div>
  );
}

function RequestRows({ headingId, children }: { headingId: string; children: ReactNode }) {
  return (
    <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
      <thead>
        <tr>
          <Th>{t("pool.col.team")}</Th>
          <Th>
            <span className="sr-only">{t("pool.col.actions")}</span>
          </Th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function CaptainPanel({ captain }: { captain: NonNullable<PageData["captain"]> }) {
  const { run, error, failures, pending } = usePoolAction();
  const headingId = useId();
  const search = Route.useSearch();
  const [invited, setInvited] = useState(false);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id={headingId}>{t("pool.captain.title")}</SectionHeading>
      <p>{t(captain.missing === 1 ? "pool.captain.missing" : "pool.captain.missing_other", { team: captain.teamName, count: captain.missing })}</p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <FilterSelect name="role" label={t("pool.filter.role")} value={search.role} options={ROLES.map((r) => [r, t(`pool.role.${r}`)])} />
        <FilterSelect name="minTier" label={t("pool.filter.minRank")} value={search.minTier} options={TIERS.map((r) => [r, t(`rank.tier.${r}`)])} />
        <FilterSelect name="maxTier" label={t("pool.filter.maxRank")} value={search.maxTier} options={TIERS.map((r) => [r, t(`rank.tier.${r}`)])} />
        <Button type="submit" variant="secondary">
          {t("pool.filter.apply")}
        </Button>
      </form>
      {error && <FormAlert>{error}</FormAlert>}
      {failures.length > 0 && <FailureList failures={failures} />}
      {invited && !error && failures.length === 0 && <p role="status">{t("pool.captain.invited")}</p>}
      <PoolTable
        headingId={headingId}
        players={captain.pool}
        disabled={pending}
        onInvite={async (userId) => {
          setInvited(await run(() => recruitFromPoolFn({ data: { registrationId: captain.registrationId, userId } })));
        }}
      />
    </section>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: (readonly [string, string])[];
}) {
  const id = useId();
  return (
    <Field id={id} label={label}>
      <select id={id} name={name} defaultValue={value ?? ""} className="h-11 rounded-[4px] border border-line bg-surface-raised px-3 text-ink">
        <option value="">{t("pool.filter.any")}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}
