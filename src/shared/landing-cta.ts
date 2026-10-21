import type { ViewerState } from "../server/viewer.functions";
import type { MessageKey } from "./i18n";
import { riotIdToSlug } from "./riot-id";

export type LandingCta = { labelKey: MessageKey; href: string };

export function getLandingCta(viewer: ViewerState): LandingCta {
  if (!viewer.signedIn) return { labelKey: "cup.cta.signUp", href: "/ingresar" };
  if (!viewer.riotAccount) return { labelKey: "cup.cta.linkRiot", href: "/vincular-riot" };
  return { labelKey: "cup.cta.ready", href: `/jugador/${riotIdToSlug(viewer.riotAccount)}` };
}
