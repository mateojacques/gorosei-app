import { useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Field, FormAlert } from "@/components/site/form";
import { Th } from "@/components/team/team-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearRankOverrideFn,
  findPlayerFn,
  forceRemoveFn,
  type getAdminRegistrations,
  grantExceptionFn,
  grantManualCreditFn,
  markPaidFn,
  revokeCreditFn,
  setRankOverrideFn,
  unmarkPaidFn,
  useCreditFn,
} from "@/server/tournaments/admin.functions";
import { formatFailure } from "@/shared/eligibility";
import { type MessageKey, t } from "@/shared/i18n";
import { DIVISIONS, type Division, TIERS, type Tier, formatRank, isApexTier } from "@/shared/rank";
import { ROSTER_STARTERS, type RegistrationStatus } from "@/shared/tournament";
import { RegistrationStatusLabel } from "./registration-status";

type Registration = Awaited<ReturnType<typeof getAdminRegistrations>>[number];
type Result = { ok: true } | { ok: false; reason: string };
type ErrorPrefix = "payment.error" | "credit.error" | "registration.error";

/** Runs an admin action: a failure shows the service's reason, a success reloads the page data. */
function useAdminAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<Result>, prefix: ErrorPrefix): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(t(`${prefix}.${result.reason}` as MessageKey));
        return false;
      }
      await router.invalidate();
      return true;
    } catch {
      setError(t("common.error"));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, error, pending };
}

const GROUPS: { key: string; statuses: RegistrationStatus[] }[] = [
  { key: "confirmed", statuses: ["confirmed"] },
  { key: "waitlisted", statuses: ["waitlisted"] },
  { key: "pending", statuses: ["pending"] },
  { key: "inactive", statuses: ["withdrawn", "dropped"] },
];

export function AdminRegistrations({
  tournamentId,
  free,
  registrations,
}: {
  tournamentId: string;
  free: boolean;
  registrations: Registration[];
}) {
  return (
    <section className="flex flex-col gap-8 border-t border-line pt-6">
      <h2 className="font-display text-2xl font-extrabold uppercase">{t("admin.registrations.title")}</h2>
      {registrations.length === 0 && <p className="text-ink-muted">{t("admin.registrations.empty")}</p>}
      {GROUPS.map(({ key, statuses }) => {
        const group = registrations.filter((r) => statuses.includes(r.status));
        if (group.length === 0) return null;
        return (
          <div key={key} className="flex flex-col gap-6">
            <h3 className="font-display text-xl font-extrabold text-ink-muted uppercase">
              {t(`admin.registrations.group.${key}` as MessageKey)} · {group.length}
            </h3>
            {group.map((registration) => (
              <RegistrationBlock key={registration.id} tournamentId={tournamentId} free={free} registration={registration} />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function RegistrationBlock({ tournamentId, free, registration }: { tournamentId: string; free: boolean; registration: Registration }) {
  const id = useId();
  const { run, error, pending } = useAdminAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reference, setReference] = useState("");
  const active = registration.status !== "withdrawn" && registration.status !== "dropped";
  const failedRules = [...new Set(registration.failures.map((f) => f.ruleId))];

  async function markPaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(
      () => markPaidFn({ data: { tournamentId, userIds: [...selected], reference } }),
      "payment.error",
    );
    if (ok) {
      setSelected(new Set());
      setReference("");
    }
  }

  return (
    <section aria-labelledby={`${id}-team`} className="flex flex-col gap-4 border-b border-line pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h4 id={`${id}-team`} className="font-display text-2xl font-black uppercase">
          {registration.team.name}
        </h4>
        <p className="flex flex-wrap items-baseline gap-x-4">
          <RegistrationStatusLabel status={registration.status} />
          {!free && (
            <span className="tabular-nums">
              {t("registration.paidProgress", { paid: registration.paidCount, total: ROSTER_STARTERS })}
            </span>
          )}
        </p>
      </div>
      <form method="post" onSubmit={markPaid} className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr>
                {!free && (
                  <Th>
                    <span className="sr-only">{t("admin.registrations.markPaid")}</span>
                  </Th>
                )}
                <Th>{t("registration.col.player")}</Th>
                <Th>{t("registration.col.rank")}</Th>
                {!free && <Th>{t("registration.col.paid")}</Th>}
                <Th>{t("admin.registrations.credits")}</Th>
                <Th>
                  <span className="sr-only">{t("team.col.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {registration.roster.map((player) => (
                <tr key={player.userId} className="border-b border-line align-top">
                  {!free && (
                    <td className="py-2 pr-2">
                      {!player.paid && active && (
                        <input
                          type="checkbox"
                          className="size-4 accent-cobalt-light"
                          aria-label={t("admin.registrations.select", { riotId: player.riotId })}
                          checked={selected.has(player.userId)}
                          onChange={(e) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(player.userId);
                              else next.delete(player.userId);
                              return next;
                            })
                          }
                        />
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <span className="font-semibold [overflow-wrap:anywhere]">{player.riotId}</span>
                    <span className="block text-ink-muted">{player.isSub ? t("registration.sub") : t("registration.starter")}</span>
                  </td>
                  <td className="py-2 pr-3">{formatRank(player.rank)}</td>
                  {!free && <td className="py-2 pr-3">{player.paid ? "✓" : "—"}</td>}
                  <td className="py-2 pr-3 tabular-nums">{player.availableCredits}</td>
                  <td className="py-1 text-right">
                    {!free && player.paid && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-0"
                        disabled={pending}
                        onClick={() => run(() => unmarkPaidFn({ data: { tournamentId, userId: player.userId } }), "payment.error")}
                      >
                        {t("admin.registrations.unmark")}
                      </Button>
                    )}
                    {!free && !player.paid && active && player.availableCredits > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-0"
                        disabled={pending}
                        onClick={() => run(() => useCreditFn({ data: { tournamentId, userId: player.userId } }), "credit.error")}
                      >
                        {t("admin.registrations.useCredit")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!free && active && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 grow sm:grow-0">
              <Field id={`${id}-reference`} label={t("admin.registrations.reference")}>
                <Input
                  id={`${id}-reference`}
                  value={reference}
                  placeholder={t("admin.registrations.referencePlaceholder")}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={pending || selected.size === 0 || !reference.trim()}>
              {t("admin.registrations.markPaid")}
            </Button>
          </div>
        )}
      </form>
      {registration.failures.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {registration.failures.map((f, i) => (
            <li key={`${f.ruleId}-${f.userId ?? i}`}>{formatFailure(f)}</li>
          ))}
        </ul>
      )}
      {active && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {failedRules.map((ruleId) => (
            <ReasonAction
              key={ruleId}
              label={t("admin.registrations.grantException")}
              title={t("admin.registrations.exceptionFor", { ruleId })}
              reasonLabel={t("admin.registrations.exceptionReason")}
              confirmLabel={t("admin.registrations.confirm")}
              pending={pending}
              onConfirm={(reason) =>
                run(() => grantExceptionFn({ data: { tournamentId, teamId: registration.team.id, ruleId, reason } }), "registration.error")
              }
            />
          ))}
          <ReasonAction
            label={t("admin.registrations.remove")}
            reasonLabel={t("admin.registrations.removeReason")}
            confirmLabel={t("admin.registrations.removeConfirm")}
            pending={pending}
            onConfirm={(reason) => run(() => forceRemoveFn({ data: { registrationId: registration.id, reason } }), "registration.error")}
          />
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}

/** A quiet action that opens a required-reason field before it runs. */
function ReasonAction({
  label,
  title,
  reasonLabel,
  confirmLabel,
  pending,
  onConfirm,
}: {
  label: string;
  title?: string;
  reasonLabel: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      method="post"
      className="flex w-full max-w-md flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onConfirm(reason)) setOpen(false);
      }}
    >
      {title && <p className="font-semibold">{title}</p>}
      <Field id={`${id}-reason`} label={reasonLabel}>
        <Input id={`${id}-reason`} value={reason} required onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !reason.trim()}>
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => setOpen(false)}>
          {t("admin.registrations.back")}
        </Button>
      </div>
    </form>
  );
}

type Player = NonNullable<Awaited<ReturnType<typeof findPlayerFn>>>;

/** Finds a player by Riot ID to manage their entry credits and rank override. */
export function PlayerPanel() {
  const id = useId();
  const [riotId, setRiotId] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load(query: string) {
    setPending(true);
    setError(null);
    try {
      const found = await findPlayerFn({ data: { riotId: query } });
      setPlayer(found);
      setNotFound(!found);
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5 border-t border-line pt-6">
      <h2 id={`${id}-title`} className="font-display text-2xl font-extrabold uppercase">
        {t("admin.player.title")}
      </h2>
      <form
        method="post"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load(riotId);
        }}
      >
        <div className="min-w-60 grow sm:grow-0">
          <Field id={`${id}-riot-id`} label={t("admin.player.riotId")}>
            <Input id={`${id}-riot-id`} value={riotId} required placeholder="nombre#LAS" onChange={(e) => setRiotId(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("admin.player.search")}
        </Button>
      </form>
      {notFound && <p className="text-ink-muted">{t("admin.player.notFound")}</p>}
      {error && <FormAlert>{error}</FormAlert>}
      {player && <PlayerDetails key={player.riotAccountId} player={player} reload={() => load(`${player.gameName}#${player.tagLine}`)} />}
    </section>
  );
}

function PlayerDetails({ player, reload }: { player: Player; reload: () => Promise<void> }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [tier, setTier] = useState<Tier>("GOLD");
  const [division, setDivision] = useState<Division>("IV");
  const [reason, setReason] = useState("");
  const available = player.credits.filter((c) => c.status === "available").length;

  async function act(action: () => Promise<Result>) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) setError(t(`credit.error.${result.reason}` as MessageKey));
      else await reload();
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-2xl font-black [overflow-wrap:anywhere]">
          {player.gameName}#{player.tagLine}
        </p>
        <p className="font-semibold">
          {t(available === 1 ? "admin.player.availableCredits" : "admin.player.availableCredits_other", { count: available })}
        </p>
      </div>

      <Sub title={t("admin.player.credits")}>
        {player.credits.length === 0 ? (
          <p className="text-ink-muted">{t("admin.player.noCredits")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
              <thead>
                <tr>
                  <Th>{t("admin.player.col.reason")}</Th>
                  <Th>{t("admin.player.col.status")}</Th>
                  <Th>{t("admin.player.col.note")}</Th>
                  <Th>
                    <span className="sr-only">{t("team.col.actions")}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {player.credits.map((credit) => (
                  <tr key={credit.id} className="border-b border-line">
                    <td className="py-2 pr-3">{t(`admin.player.credit.reason.${credit.reason}`)}</td>
                    <td className="py-2 pr-3">{t(`admin.player.credit.status.${credit.status}`)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{credit.note}</td>
                    <td className="py-1 text-right">
                      {credit.status === "available" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-0"
                          disabled={pending}
                          onClick={() => act(() => revokeCreditFn({ data: { creditId: credit.id } }))}
                        >
                          {t("admin.player.revoke")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          method="post"
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await act(() => grantManualCreditFn({ data: { userId: player.userId, note } }));
            setNote("");
          }}
        >
          <div className="min-w-60 grow sm:grow-0">
            <Field id={`${id}-note`} label={t("admin.player.grantNote")}>
              <Input id={`${id}-note`} value={note} required onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={pending || !note.trim()}>
            {t("admin.player.grant")}
          </Button>
        </form>
      </Sub>

      <Sub title={t("admin.player.override")}>
        <p>
          {player.override
            ? t("admin.player.overrideCurrent", {
                rank: formatRank({ tier: player.override.tier as Tier, division: player.override.division as Division, lp: 0 }),
                reason: player.override.reason,
              })
            : t("admin.player.overrideNone")}
        </p>
        <form
          method="post"
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => setRankOverrideFn({ data: { riotAccountId: player.riotAccountId, tier, division, reason } }));
          }}
        >
          <Field id={`${id}-tier`} label={t("admin.player.override")}>
            <select id={`${id}-tier`} value={tier} onChange={(e) => setTier(e.target.value as Tier)} className={selectClass}>
              {TIERS.map((value) => (
                <option key={value} value={value}>
                  {t(`rank.tier.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-division`} label={t("admin.player.division")}>
            <select
              id={`${id}-division`}
              value={division}
              disabled={isApexTier(tier)}
              onChange={(e) => setDivision(e.target.value as Division)}
              className={selectClass}
            >
              {DIVISIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field id={`${id}-override-reason`} label={t("admin.player.overrideReason")}>
              <Input id={`${id}-override-reason`} value={reason} required onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={pending || !reason.trim()}>
              {t("admin.player.setOverride")}
            </Button>
            {player.override && (
              <Button
                type="button"
                variant="ghost"
                className="px-0"
                disabled={pending}
                onClick={() => act(() => clearRankOverrideFn({ data: { riotAccountId: player.riotAccountId } }))}
              >
                {t("admin.player.clearOverride")}
              </Button>
            )}
          </div>
        </form>
      </Sub>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

const selectClass = "h-11 w-full rounded-[4px] border border-line bg-surface-raised px-3 text-ink disabled:opacity-50";

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 font-display text-lg font-extrabold text-ink-muted uppercase">{title}</h3>
      {children}
    </div>
  );
}
