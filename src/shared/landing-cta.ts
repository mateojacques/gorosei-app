import type { ViewerState } from "../server/viewer.functions";
import type { MessageKey } from "./i18n";
import { riotIdToSlug } from "./riot-id";
import type { TournamentStatus } from "./tournament";

export type LandingCta = { labelKey: MessageKey; href: string };

export function getLandingCta(viewer: ViewerState, tournament: { slug: string; status: TournamentStatus } | null): LandingCta {
  if (!viewer.signedIn) return { labelKey: "cup.cta.signUp", href: "/ingresar" };
  if (!viewer.riotAccount) return { labelKey: "cup.cta.linkRiot", href: "/vincular-riot" };
  if (!tournament) return { labelKey: "cup.cta.ready", href: `/jugador/${riotIdToSlug(viewer.riotAccount)}` };
  if (tournament.status === "registration_open") {
    return { labelKey: "cup.cta.register", href: `/torneos/${tournament.slug}/inscribir` };
  }
  return { labelKey: "cup.cta.viewTournament", href: `/torneos/${tournament.slug}` };
}
