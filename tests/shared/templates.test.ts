import { describe, expect, test } from "bun:test";
import {
  editionInput,
  nextOccurrence,
  planNextEdition,
  templateInputSchema,
  type TemplateInput,
} from "../../src/shared/templates";
import { tournamentInputSchema } from "../../src/shared/tournament";

const saturday = { weekday: 6, startTime: "18:00" };
const schedule = { ...saturday, registrationOpensDaysBefore: 7, registrationClosesMinutesBefore: 120 };
const d = (iso: string) => new Date(iso);
const wednesday = d("2026-10-21T15:00:00Z");

const template: TemplateInput = {
  title: "Copa Semanal LAS",
  bracket: "double_elimination",
  draftMode: "tournament_draft",
  bestOf: 1,
  finalsBestOf: 3,
  teamCap: 16,
  maxSubs: 1,
  subsCountForTeamRules: false,
  rankSource: "peak_season",
  eligibilityRules: [],
  entryFeeArs: 5000,
  prizeGoalArs: 300000,
  prizeSplit: [70, 30],
  paymentInstructions: "Mercado Pago",
  rulesText: "Reglas",
  streamUrl: "https://twitch.tv/gorosei",
  ...schedule,
  nextEdition: 13,
  active: true,
};

describe("nextOccurrence", () => {
  test("finds the next Saturday 18:00 ART", () => {
    expect(nextOccurrence(saturday, wednesday)).toEqual(d("2026-10-24T21:00:00Z"));
  });
  test("is strictly after the given instant", () => {
    expect(nextOccurrence(saturday, d("2026-10-24T21:00:00Z"))).toEqual(d("2026-10-31T21:00:00Z"));
    expect(nextOccurrence(saturday, d("2026-10-24T20:59:00Z"))).toEqual(d("2026-10-24T21:00:00Z"));
  });
  test("handles times that cross the UTC date", () => {
    expect(nextOccurrence({ weekday: 5, startTime: "22:30" }, wednesday)).toEqual(d("2026-10-24T01:30:00Z"));
    expect(nextOccurrence({ weekday: 0, startTime: "00:30" }, wednesday)).toEqual(d("2026-10-25T03:30:00Z"));
  });
});

describe("planNextEdition", () => {
  test("first edition of a new template", () => {
    expect(planNextEdition(schedule, null, false, wednesday)).toEqual({
      startsAt: d("2026-10-24T21:00:00Z"),
      registrationClosesAt: d("2026-10-24T19:00:00Z"),
      createAt: d("2026-10-17T21:00:00Z"),
    });
  });
  test("waits while an edition is upcoming and its successor's window is not open", () => {
    expect(planNextEdition(schedule, d("2026-10-24T21:00:00Z"), true, d("2026-10-24T20:59:00Z"))).toBeNull();
  });
  test("creates the next one when the window opens", () => {
    expect(planNextEdition(schedule, d("2026-10-24T21:00:00Z"), true, d("2026-10-24T21:00:00Z"))?.startsAt).toEqual(
      d("2026-10-31T21:00:00Z"),
    );
  });
  test("skips a week whose registration already closed", () => {
    expect(planNextEdition(schedule, null, false, d("2026-10-24T19:30:00Z"))?.startsAt).toEqual(d("2026-10-31T21:00:00Z"));
  });
  test("after three weeks of downtime makes one edition, in the future", () => {
    const plan = planNextEdition(schedule, d("2026-10-03T21:00:00Z"), false, d("2026-10-24T15:00:00Z"));
    expect(plan?.startsAt).toEqual(d("2026-10-24T21:00:00Z"));
  });
  test("a cancelled future edition is followed at once", () => {
    const plan = planNextEdition(schedule, d("2026-10-31T21:00:00Z"), false, wednesday);
    expect(plan?.startsAt).toEqual(d("2026-11-07T21:00:00Z"));
  });
  test("never leaves the template without an upcoming edition", () => {
    const short = { ...schedule, registrationOpensDaysBefore: 2 };
    const plan = planNextEdition(short, d("2026-10-24T21:00:00Z"), false, d("2026-10-25T02:00:00Z"));
    expect(plan?.startsAt).toEqual(d("2026-10-31T21:00:00Z"));
  });
});

describe("editionInput", () => {
  test("copies the template and sets edition and dates", () => {
    const plan = planNextEdition(schedule, null, false, wednesday)!;
    const input = editionInput(template, plan, 13);
    expect(input).toEqual({
      title: "Copa Semanal LAS",
      edition: 13,
      startsAt: plan.startsAt,
      registrationClosesAt: plan.registrationClosesAt,
      bracket: "double_elimination",
      draftMode: "tournament_draft",
      bestOf: 1,
      finalsBestOf: 3,
      teamCap: 16,
      maxSubs: 1,
      subsCountForTeamRules: false,
      rankSource: "peak_season",
      eligibilityRules: [],
      entryFeeArs: 5000,
      prizeGoalArs: 300000,
      prizeSplit: [70, 30],
      paymentInstructions: "Mercado Pago",
      rulesText: "Reglas",
      streamUrl: "https://twitch.tv/gorosei",
    });
    expect(tournamentInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("templateInputSchema", () => {
  test("accepts a valid template and applies defaults", () => {
    const { registrationOpensDaysBefore: _o, registrationClosesMinutesBefore: _c, ...rest } = template;
    const parsed = templateInputSchema.parse(rest);
    expect(parsed.registrationOpensDaysBefore).toBe(7);
    expect(parsed.registrationClosesMinutesBefore).toBe(120);
  });
  test("rejects bad schedules", () => {
    const bad = (patch: Record<string, unknown>) => templateInputSchema.safeParse({ ...template, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ startTime: "24:00" })).toBe(false);
    expect(bad({ startTime: "7:05" })).toBe(false);
    expect(bad({ weekday: 7 })).toBe(false);
    expect(bad({ registrationOpensDaysBefore: 0 })).toBe(false);
    expect(bad({ registrationClosesMinutesBefore: 59 })).toBe(false);
    expect(bad({ nextEdition: 0 })).toBe(false);
  });
});
