import { z } from "zod";
import { eligibilityRulesSchema } from "./eligibility";

export const TOURNAMENT_STATUSES = [
  "draft",
  "registration_open",
  "registration_closed",
  "check_in",
  "live",
  "finished",
  "cancelled",
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const ROSTER_STARTERS = 5;

export const RANK_SOURCES = ["current", "peak_season"] as const;

export const REGISTRATION_STATUSES = ["pending", "confirmed", "waitlisted", "withdrawn", "dropped"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

const bestOf = z.union([z.literal(1), z.literal(3), z.literal(5)]);

export const tournamentInputSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    edition: z.number().int().min(1),
    startsAt: z.coerce.date(),
    registrationClosesAt: z.coerce.date(),
    bracket: z.enum(["double_elimination", "single_elimination"]),
    draftMode: z.enum(["tournament_draft", "blind_pick"]),
    bestOf,
    finalsBestOf: bestOf,
    teamCap: z.number().int().min(2).max(128),
    maxSubs: z.number().int().min(0).max(2),
    subsCountForTeamRules: z.boolean(),
    rankSource: z.enum(RANK_SOURCES),
    eligibilityRules: eligibilityRulesSchema,
    entryFeeArs: z.number().int().min(0),
    prizeGoalArs: z.number().int().min(0),
    prizeSplit: z
      .array(z.number().int().positive())
      .min(1)
      .max(8)
      .refine((split) => split.reduce((a, b) => a + b, 0) === 100, { message: "split must sum to 100" }),
    paymentInstructions: z.string().max(2000),
    rulesText: z.string().max(20000),
    streamUrl: z.union([z.url(), z.literal("")]),
  })
  .refine((v) => v.registrationClosesAt < v.startsAt, {
    path: ["registrationClosesAt"],
    message: "registration must close before the start",
  });

export type TournamentInput = z.infer<typeof tournamentInputSchema>;
