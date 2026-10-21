import { expect, test } from "@playwright/test";
import { RIOT_NOTICE } from "./public-routes";

test("the privacy policy is server-rendered", async ({ request }) => {
  const res = await request.get("/privacidad");
  const html = (await res.text()).replaceAll("&#x27;", "'");

  expect(res.status()).toBe(200);
  expect(html).toMatch(/<a [^>]*href="mailto:mateojacquesweb@gmail.com"/);
  expect(html).toContain("Riot ID");
  expect(html).toContain("PUUID");
  expect(html).toMatch(/<h1[^>]*>Política de privacidad<\/h1>/);
  expect(html).toContain(RIOT_NOTICE);
  expect(html).toMatch(/<title>[^<]*Privacidad[^<]*<\/title>/);
});
