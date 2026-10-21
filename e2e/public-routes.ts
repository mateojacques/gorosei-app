import { createTeam } from "../src/server/teams/teams";
import { riotIdToSlug } from "../src/shared/riot-id";
import { createTestRiotAccount, resetTestDb, testDb } from "../tests/helpers/db";

export const RIOT_NOTICE =
  "Gorosei isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

export const seededRiotId = { gameName: "Señor Café", tagLine: "LAS" };
export const seededTeam = { name: "La Escuadra", tag: "ESC", slug: "la-escuadra" };

// Every public page; layout and shell specs both iterate this list.
export const PUBLIC_ROUTES = [
  "/",
  "/ingresar",
  "/vincular-riot",
  "/privacidad",
  `/jugador/${riotIdToSlug(seededRiotId)}`,
  `/jugador/${riotIdToSlug({ gameName: "Nadie", tagLine: "LAS" })}`,
  `/equipos/${seededTeam.slug}`,
];

export async function seedPublicRoutes(): Promise<void> {
  await resetTestDb();
  await createTestRiotAccount("e2e-user", { puuid: "e2e-puuid", ...seededRiotId });
  const team = await createTeam(testDb, "e2e-user", { name: seededTeam.name, tag: seededTeam.tag });
  if (!team.ok || team.slug !== seededTeam.slug) throw new Error("seedPublicRoutes: could not seed the team");
}
