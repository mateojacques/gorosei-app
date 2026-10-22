import { expect, test } from "bun:test";
import type { PgBoss } from "pg-boss";
import { registerJobs } from "../../../src/server/jobs/boss";

test("registerJobs schedules rank polling every 6 hours and registration close and tournament advance every minute", async () => {
  const calls: string[] = [];
  const boss = {
    createQueue: async (name: string) => void calls.push(`createQueue ${name}`),
    schedule: async (name: string, cron: string) => void calls.push(`schedule ${name} ${cron}`),
    work: async (name: string) => (calls.push(`work ${name}`), "worker-id"),
  } as unknown as PgBoss;

  await registerJobs(boss);

  expect(calls).toEqual([
    "createQueue poll-ranks",
    "schedule poll-ranks 0 */6 * * *",
    "work poll-ranks",
    "createQueue close-registrations",
    "schedule close-registrations * * * * *",
    "work close-registrations",
    "createQueue advance-tournaments",
    "schedule advance-tournaments * * * * *",
    "work advance-tournaments",
    "createQueue create-editions",
    "schedule create-editions * * * * *",
    "work create-editions",
  ]);
});
