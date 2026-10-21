import { riotIdToSlug } from "../src/shared/riot-id";
import { createTestRiotAccount, resetTestDb } from "../tests/helpers/db";

export const RIOT_NOTICE =
  "Gorosei isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

export const seededRiotId = { gameName: "Señor Café", tagLine: "LAS" };

// Every public page; layout and shell specs both iterate this list.
export const PUBLIC_ROUTES = [
  "/",
  "/ingresar",
  "/vincular-riot",
  `/jugador/${riotIdToSlug(seededRiotId)}`,
  `/jugador/${riotIdToSlug({ gameName: "Nadie", tagLine: "LAS" })}`,
];

export async function seedPublicRoutes(): Promise<void> {
  await resetTestDb();
  await createTestRiotAccount("e2e-user", { puuid: "e2e-puuid", ...seededRiotId });
}
