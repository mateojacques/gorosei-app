import { z } from "zod";
import { tournamentFieldsSchema, type TournamentInput } from "./tournament";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// ART is a fixed UTC−03:00 offset (no DST).
const ART_OFFSET_MS = -3 * 3_600_000;

export const templateInputSchema = tournamentFieldsSchema
  .omit({ edition: true, startsAt: true, registrationClosesAt: true })
  .extend({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    registrationOpensDaysBefore: z.number().int().min(1).max(28).default(7),
    registrationClosesMinutesBefore: z.number().int().min(60).max(10080).default(120),
    nextEdition: z.number().int().min(1),
    active: z.boolean(),
  });

export type TemplateInput = z.infer<typeof templateInputSchema>;
export type TemplateSchedule = Pick<
  TemplateInput,
  "weekday" | "startTime" | "registrationOpensDaysBefore" | "registrationClosesMinutesBefore"
>;
export type EditionPlan = { startsAt: Date; registrationClosesAt: Date; createAt: Date };

/** The first instant strictly after `after` that falls on the template's ART weekday and time. */
export function nextOccurrence(t: Pick<TemplateInput, "weekday" | "startTime">, after: Date): Date {
  const [hours, minutes] = t.startTime.split(":").map(Number) as [number, number];
  const local = new Date(after.getTime() + ART_OFFSET_MS);
  const candidate = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hours, minutes),
  );
  candidate.setUTCDate(candidate.getUTCDate() + ((t.weekday - local.getUTCDay() + 7) % 7));
  if (candidate.getTime() <= local.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return new Date(candidate.getTime() - ART_OFFSET_MS);
}

/**
 * The edition a template should create now, or null when it should wait. `latestStartsAt` is the
 * latest start among the template's editions in any status; `hasUpcoming` says whether one of them
 * is still before its start. With nothing upcoming the next edition is created at once.
 */
export function planNextEdition(
  t: TemplateSchedule,
  latestStartsAt: Date | null,
  hasUpcoming: boolean,
  now: Date,
): EditionPlan | null {
  const from = latestStartsAt && latestStartsAt > now ? latestStartsAt : now;
  let start = nextOccurrence(t, from).getTime();
  const closesMs = t.registrationClosesMinutesBefore * MINUTE_MS;
  while (start - closesMs <= now.getTime()) start += WEEK_MS;
  const createAt = new Date(start - t.registrationOpensDaysBefore * DAY_MS);
  if (hasUpcoming && now < createAt) return null;
  return { startsAt: new Date(start), registrationClosesAt: new Date(start - closesMs), createAt };
}

export function editionInput(t: TemplateInput, plan: EditionPlan, edition: number): TournamentInput {
  return {
    title: t.title,
    edition,
    startsAt: plan.startsAt,
    registrationClosesAt: plan.registrationClosesAt,
    bracket: t.bracket,
    draftMode: t.draftMode,
    bestOf: t.bestOf,
    finalsBestOf: t.finalsBestOf,
    teamCap: t.teamCap,
    maxSubs: t.maxSubs,
    subsCountForTeamRules: t.subsCountForTeamRules,
    rankSource: t.rankSource,
    eligibilityRules: t.eligibilityRules,
    entryFeeArs: t.entryFeeArs,
    prizeGoalArs: t.prizeGoalArs,
    prizeSplit: t.prizeSplit,
    paymentInstructions: t.paymentInstructions,
    rulesText: t.rulesText,
    streamUrl: t.streamUrl,
  };
}
