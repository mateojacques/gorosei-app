import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { type MessageKey, t } from "@/shared/i18n";
import { esAR } from "@/shared/i18n/es-AR";
import { Button } from "../ui/button";

type Result = { ok: true } | { ok: false; reason: string };

export function reasonMessage(reason: string): string {
  const key = `matchday.error.${reason}` as MessageKey;
  return key in esAR ? t(key) : t("common.error");
}

/**
 * Runs a match-day action: on success the page reloads its data, on failure the reason's message is shown.
 * A call that throws (expired session, network down) gets the generic error instead of a stuck button.
 */
export function useMatchAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run<R extends Result>(action: () => Promise<R>, success?: (result: Extract<R, { ok: true }>) => string | undefined): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(reasonMessage(result.reason));
        return false;
      }
      setNotice(success?.(result as Extract<R, { ok: true }>) ?? null);
      await router.invalidate();
      return true;
    } catch {
      setError(t("common.error"));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, error, notice, pending };
}

/** Two-step button for actions that are hard to undo: the first press asks, the second does it. */
export function ConfirmButton({
  label,
  disabled,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="sm" className="px-0" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {t("console.sure", { action: label })}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => setAsking(false)}>
        {t("matchday.cancel")}
      </Button>
    </span>
  );
}
