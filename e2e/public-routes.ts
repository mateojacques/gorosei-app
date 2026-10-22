import { createTeam } from "../src/server/teams/teams";
import { riotIdToSlug } from "../src/shared/riot-id";
import { createTestRegistration, createTestTournament } from "../tests/helpers/competition";
import { createTestRiotAccount, resetTestDb, testDb } from "../tests/helpers/db";

export const RIOT_NOTICE =
  "Gorosei isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

export const seededRiotId = { gameName: "Señor Café", tagLine: "LAS" };
export const seededTeam = { name: "La Escuadra", tag: "ESC", slug: "la-escuadra" };
export const seededTournament = { title: "Copa Semanal LAS", edition: 1, slug: "copa-semanal-las-1" };

// Every public page; layout and shell specs both iterate this list.
export const PUBLIC_ROUTES = [
  "/",
  "/ingresar",
  "/vincular-riot",
  "/privacidad",
  `/jugador/${riotIdToSlug(seededRiotId)}`,
  `/jugador/${riotIdToSlug({ gameName: "Nadie", tagLine: "LAS" })}`,
  `/equipos/${seededTeam.slug}`,
  `/torneos/${seededTournament.slug}`,
  `/torneos/${seededTournament.slug}/equipos/${seededTeam.slug}`,
  `/torneos/${seededTournament.slug}/agentes-libres`,
];

export async function seedPublicRoutes(): Promise<void> {
  await resetTestDb();
  await createTestRiotAccount("e2e-user", { puuid: "e2e-puuid", ...seededRiotId });
  const team = await createTeam(testDb, "e2e-user", { name: seededTeam.name, tag: seededTeam.tag });
  if (!team.ok || team.slug !== seededTeam.slug) throw new Error("seedPublicRoutes: could not seed the team");
  const tournament = await createTestTournament({
    title: seededTournament.title,
    edition: seededTournament.edition,
    status: "registration_open",
    eligibilityRules: [{ id: "r1", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } }],
    paymentInstructions: "Transferí al alias gorosei.copa y mandanos el comprobante.",
    rulesText: "Partidas al mejor de uno.\nLa final es al mejor de tres.",
    streamUrl: "https://www.twitch.tv/gorosei",
  });
  if (tournament.slug !== seededTournament.slug) throw new Error("seedPublicRoutes: could not seed the tournament");
  await createTestRegistration(tournament.id, team.teamId, { starters: ["e2e-user"], subs: [] });
}
