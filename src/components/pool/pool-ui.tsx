import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { EligibilityFailure } from "@/shared/eligibility";
import { type MessageKey, t } from "@/shared/i18n";

type PoolReason = { [K in MessageKey]: K extends `pool.error.${infer R}` ? R : never }[MessageKey];
type PoolActionResult = { ok: true } | { ok: false; reason: PoolReason; failures?: EligibilityFailure[] };

/**
 * Runs a pool action: success reloads the page data, failure shows the reason (eligibility failures one by one).
 * A call that throws (expired session, network down) gets the generic error instead of a stuck button.
 */
export function usePoolAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<EligibilityFailure[]>([]);
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<PoolActionResult>): Promise<boolean> {
    setPending(true);
    setError(null);
    setFailures([]);
    try {
      const result = await action();
      if (!result.ok) {
        if (result.failures?.length) setFailures(result.failures);
        else setError(t(`pool.error.${result.reason}`));
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
  return { run, error, failures, pending };
}
