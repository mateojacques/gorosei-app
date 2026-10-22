import { expect, test } from "bun:test";
import { FALLBACK_DDRAGON_VERSION, createDdragon, profileIconUrl } from "../../../src/server/riot/ddragon";

function stubFetch(reply: () => Response) {
  let calls = 0;
  const fetch = (async () => {
    calls++;
    return reply();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

test("profileIconUrl points at Riot's Data Dragon image for that icon", () => {
  expect(profileIconUrl("15.20.1", 11)).toBe("https://ddragon.leagueoflegends.com/cdn/15.20.1/img/profileicon/11.png");
});

test("the latest version is the first one Data Dragon lists, and it is cached", async () => {
  const stub = stubFetch(() => Response.json(["15.21.1", "15.20.1"]));
  let now = 0;
  const ddragon = createDdragon({ fetch: stub.fetch, now: () => now });

  expect(await ddragon.latestVersion()).toBe("15.21.1");
  now += 60 * 60 * 1000;
  expect(await ddragon.latestVersion()).toBe("15.21.1");
  expect(stub.calls()).toBe(1);
});

test("an unreachable Data Dragon falls back to a known version instead of failing the page", async () => {
  const stub = stubFetch(() => new Response(null, { status: 503 }));
  const ddragon = createDdragon({ fetch: stub.fetch, now: () => 0 });

  expect(await ddragon.latestVersion()).toBe(FALLBACK_DDRAGON_VERSION);
});
