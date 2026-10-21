import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES, seedPublicRoutes } from "./public-routes";

const WIDTHS = [320, 360, 768, 1280];

test.use({ javaScriptEnabled: true });
test.beforeAll(seedPublicRoutes);

for (const route of PUBLIC_ROUTES) {
  for (const width of WIDTHS) {
    test(`${route} has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
