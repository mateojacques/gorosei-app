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

  await registerJobs(boss, { tournamentCodes: false });

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
    "createQueue send-emails",
    "schedule send-emails * * * * *",
    "work send-emails",
  ]);
});

test("tournament codes are issued every minute only with the capability on", async () => {
  const queues: string[] = [];
  const boss = {
    createQueue: async (name: string) => void queues.push(name),
    schedule: async () => {},
    work: async () => "worker-id",
  } as unknown as PgBoss;
  await registerJobs(boss, { tournamentCodes: false });
  expect(queues).not.toContain("issue-tournament-codes");
  await registerJobs(boss, { tournamentCodes: true });
  expect(queues).toContain("issue-tournament-codes");
});

test("Riot game results get a worker only with result callbacks on", async () => {
  const queues: string[] = [];
  const boss = {
    createQueue: async (name: string) => void queues.push(name),
    schedule: async () => {},
    work: async () => "worker-id",
  } as unknown as PgBoss;
  await registerJobs(boss, { tournamentCodes: true, resultCallbacks: false });
  expect(queues).not.toContain("riot-game-result");
  await registerJobs(boss, { tournamentCodes: true, resultCallbacks: true });
  expect(queues).toContain("riot-game-result");
});
