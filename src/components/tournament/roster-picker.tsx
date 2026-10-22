import { type FormEvent, type ReactNode, useState } from "react";
import { FormAlert } from "@/components/site/form";
import { Th } from "@/components/team/team-ui";
import { Button } from "@/components/ui/button";
import type { EligibilityFailure } from "@/shared/eligibility";
import { type MessageKey, t } from "@/shared/i18n";
import { FailureList } from "./failure-list";

type RosterReason = { [K in MessageKey]: K extends `registration.error.${infer R}` ? R : never }[MessageKey];
export type RosterActionResult = { ok: true } | { ok: false; reason: RosterReason; failures?: EligibilityFailure[] };
export type Roster = { starters: string[]; subs: string[] };
type Slot = "starter" | "sub";

/** Ticks starters and subs from a team's members and submits them; rejections show their reasons, eligibility failures one by one. */
export function RosterPicker({
  members,
  maxSubs,
  initial = { starters: [], subs: [] },
  submitLabel,
  onSubmit,
  children,
}: {
  members: { userId: string; riotId: string }[];
  maxSubs: number;
  initial?: Roster;
  submitLabel: string;
  onSubmit: (roster: Roster) => Promise<RosterActionResult>;
  children?: ReactNode;
}) {
  const [slots, setSlots] = useState<Map<string, Slot>>(
    () => new Map([...initial.starters.map((id) => [id, "starter"] as const), ...initial.subs.map((id) => [id, "sub"] as const)]),
  );
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<EligibilityFailure[]>([]);
  const [pending, setPending] = useState(false);

  function toggle(userId: string, slot: Slot, checked: boolean) {
    setSlots((current) => {
      const next = new Map(current);
      if (checked) next.set(userId, slot);
      else next.delete(userId);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pick = (slot: Slot) => members.filter((m) => slots.get(m.userId) === slot).map((m) => m.userId);
    setPending(true);
    setError(null);
    setFailures([]);
    try {
      const result = await onSubmit({ starters: pick("starter"), subs: pick("sub") });
      if (result.ok) return;
      if (result.failures?.length) setFailures(result.failures);
      else setError(t(`registration.error.${result.reason}`));
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-5">
      {children}
      <p>{maxSubs === 0 ? t("registration.register.pick_noSubs") : t(maxSubs === 1 ? "registration.register.pick" : "registration.register.pick_other", { subs: maxSubs })}</p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <Th>{t("registration.col.player")}</Th>
            <Th>{t("registration.starter")}</Th>
            {maxSubs > 0 && <Th>{t("registration.sub")}</Th>}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const slot = slots.get(member.userId);
            return (
              <tr key={member.userId} className="border-b border-line">
                <td className="py-3 pr-3 font-semibold [overflow-wrap:anywhere]">{member.riotId}</td>
                <td className="py-3 pr-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-cobalt-light"
                    aria-label={t("registration.picker.starter", { riotId: member.riotId })}
                    checked={slot === "starter"}
                    onChange={(e) => toggle(member.userId, "starter", e.target.checked)}
                  />
                </td>
                {maxSubs > 0 && (
                  <td className="py-3">
                    <input
                      type="checkbox"
                      className="size-5 accent-cobalt-light"
                      aria-label={t("registration.picker.sub", { riotId: member.riotId })}
                      checked={slot === "sub"}
                      onChange={(e) => toggle(member.userId, "sub", e.target.checked)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {failures.length > 0 && <FailureList failures={failures} />}
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
