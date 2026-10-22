import { expect, test } from "bun:test";
import { siteOrigin } from "../../../src/server/seo/origin";

test("the site origin is the origin of BETTER_AUTH_URL", () => {
  expect(siteOrigin("https://gorosei.gg/app/")).toBe("https://gorosei.gg");
  expect(siteOrigin("http://localhost:3100")).toBe("http://localhost:3100");
});
