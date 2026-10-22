import { t } from "@/shared/i18n";
import { placementLabel } from "@/shared/placement";
import type { TournamentStatus } from "@/shared/tournament";

/** A tournament placement in words; the champion gets the display type and the stage light. */
export function Placement({ rank, status }: { rank: number | null; status: TournamentStatus }) {
  const label = placementLabel(rank, status);
  const text = label.n === undefined ? t(label.key) : t(label.key, { n: label.n });
  if (label.key === "placement.champion") {
    return <span className="font-display text-xl leading-none font-black text-cobalt-light uppercase">{text}</span>;
  }
  return <span className={label.key === "placement.second" || label.key === "placement.third" ? "font-semibold" : "text-ink-muted"}>{text}</span>;
}
