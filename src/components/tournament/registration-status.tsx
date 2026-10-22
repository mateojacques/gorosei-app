import { t } from "@/shared/i18n";
import type { RegistrationStatus as Status, TournamentStatus } from "@/shared/tournament";

// The one signal-red element on a tournament screen besides its primary action.
export function TournamentStatusTag({ status }: { status: TournamentStatus }) {
  const live = status === "registration_open" || status === "check_in" || status === "live";
  return (
    <p className="inline-flex items-center gap-2 bg-signal px-2.5 py-1 font-display text-base leading-none font-extrabold tracking-[0.08em] text-white uppercase">
      {live && <span aria-hidden="true" className="status-dot size-2 rounded-full bg-white" />}
      {t(`tournament.status.${status}`)}
    </p>
  );
}

export function RegistrationStatusLabel({ status }: { status: Status }) {
  return (
    <span className="font-display text-lg leading-tight font-extrabold tracking-[0.02em] uppercase">
      {t(`registration.status.${status}`)}
    </span>
  );
}

/** The registration's status in one sentence; a pending team in a free tournament waits on its roster, not payments. */
export function RegistrationStatus({ status, free }: { status: Status; free: boolean }) {
  const explanation = status === "pending" && free ? t("registration.explain.pending_free") : t(`registration.explain.${status}`);
  return (
    <div className="flex flex-col gap-2">
      <RegistrationStatusLabel status={status} />
      <p className="max-w-prose text-lg">{explanation}</p>
    </div>
  );
}
