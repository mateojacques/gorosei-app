import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES, RIOT_NOTICE, seedPublicRoutes } from "./public-routes";

test.beforeAll(seedPublicRoutes);

for (const route of PUBLIC_ROUTES) {
  test(`${route} carries the Riot notice and a privacy link`, async ({ request }) => {
    const html = await (await request.get(route)).text();

    // React escapes the apostrophes in "isn't" / "doesn't".
    expect(html.replaceAll("&#x27;", "'").replaceAll("&#39;", "'")).toContain(RIOT_NOTICE);
    expect(html).toMatch(/<a [^>]*href="\/privacidad"/);
  });
}
