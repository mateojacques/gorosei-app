import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { type MessageKey, t } from "@/shared/i18n";
import { esAR } from "@/shared/i18n/es-AR";

type TeamReason = { [K in MessageKey]: K extends `team.error.${infer R}` ? R : never }[MessageKey];
type PoolReason = { [K in MessageKey]: K extends `pool.error.${infer R}` ? R : never }[MessageKey];
type ActionResult = { ok: true } | { ok: false; reason: TeamReason | PoolReason };

/** Pool requests are answered by pool code, whose reasons have their own messages. */
function reasonMessage(reason: TeamReason | PoolReason): string {
  const teamKey = `team.error.${reason}` as MessageKey;
  return t(teamKey in esAR ? teamKey : (`pool.error.${reason}` as MessageKey));
}

/**
 * Runs a team action: on success the page reloads its data, on failure the reason's message is shown.
 * A call that throws (expired session, network down) gets the generic error instead of a stuck button.
 */
export function useTeamAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<ActionResult>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(reasonMessage(result.reason));
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

export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display text-2xl font-extrabold uppercase">
      {children}
    </h2>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="border-b border-line pb-2 font-display text-sm font-extrabold tracking-[0.04em] text-ink-muted uppercase"
    >
      {children}
    </th>
  );
}
