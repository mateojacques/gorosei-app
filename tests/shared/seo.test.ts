import { expect, test } from "bun:test";
import { MAX_SITEMAP_URLS, absoluteUrl, eventJsonLd, jsonLdString, pageMeta, robotsTxt, sitemapXml } from "../../src/shared/seo";
import type { EventInput } from "../../src/shared/seo";

const ORIGIN = "https://gorosei.gg";
const metaValue = (meta: Record<string, string>[], key: string) =>
  meta.find((m) => m.name === key || m.property === key)?.content;

test("absoluteUrl joins origin and path", () => {
  expect(absoluteUrl("https://gorosei.gg/", "/torneos")).toBe("https://gorosei.gg/torneos");
  expect(absoluteUrl(ORIGIN, "torneos")).toBe("https://gorosei.gg/torneos");
});

test("pageMeta emits title, description, Open Graph and canonical", () => {
  const { meta, links } = pageMeta({ origin: ORIGIN, path: "/torneos?rank=GOLD", title: "Torneos · Gorosei", description: "Copas" });
  expect(meta).toContainEqual({ title: "Torneos · Gorosei" });
  expect(metaValue(meta, "description")).toBe("Copas");
  expect(metaValue(meta, "og:title")).toBe("Torneos · Gorosei");
  expect(metaValue(meta, "og:description")).toBe("Copas");
  expect(metaValue(meta, "og:type")).toBe("website");
  expect(metaValue(meta, "og:url")).toBe("https://gorosei.gg/torneos");
  expect(metaValue(meta, "og:locale")).toBe("es_AR");
  expect(metaValue(meta, "og:site_name")).toBe("Gorosei");
  expect(metaValue(meta, "twitter:card")).toBe("summary");
  expect(metaValue(meta, "og:image")).toBeUndefined();
  expect(metaValue(meta, "robots")).toBeUndefined();
  expect(links).toEqual([{ rel: "canonical", href: "https://gorosei.gg/torneos" }]);
});

test("pageMeta with an image uses a large card and absolute image URLs", () => {
  const { meta } = pageMeta({ origin: ORIGIN, path: "/torneos/copa", title: "x", description: "y", image: "/og/torneos/copa.png", type: "article" });
  expect(metaValue(meta, "twitter:card")).toBe("summary_large_image");
  expect(metaValue(meta, "og:image")).toBe("https://gorosei.gg/og/torneos/copa.png");
  expect(metaValue(meta, "twitter:image")).toBe("https://gorosei.gg/og/torneos/copa.png");
  expect(metaValue(meta, "og:type")).toBe("article");
});

test("pageMeta noindex adds robots", () => {
  const { meta } = pageMeta({ origin: ORIGIN, path: "/ingresar", title: "x", description: "y", noindex: true });
  expect(metaValue(meta, "robots")).toBe("noindex,follow");
});

const event = (extra: Partial<EventInput> = {}): EventInput => ({
  origin: ORIGIN,
  slug: "copa-semanal-12",
  title: "Copa Semanal",
  edition: 12,
  startsAt: new Date("2026-11-07T21:00:00Z"),
  status: "registration_open",
  entryFeeArs: 5000,
  prizeGoalArs: 300000,
  description: "Copa 5v5",
  imageUrl: "https://gorosei.gg/og/torneos/copa-semanal-12.png",
  ...extra,
});

test("eventJsonLd describes an online event", () => {
  const ld = eventJsonLd(event());
  expect(ld["@context"]).toBe("https://schema.org");
  expect(ld["@type"]).toBe("Event");
  expect(ld.name).toBe("Copa Semanal #12");
  expect(ld.startDate).toBe("2026-11-07T21:00:00.000Z");
  expect(ld.eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
  expect(ld.eventStatus).toBe("https://schema.org/EventScheduled");
  expect(ld.location).toEqual({ "@type": "VirtualLocation", url: "https://gorosei.gg/torneos/copa-semanal-12" });
  expect(ld.organizer).toEqual({ "@type": "Organization", name: "Gorosei", url: "https://gorosei.gg" });
  expect(ld.offers).toMatchObject({ "@type": "Offer", price: "5000", priceCurrency: "ARS", availability: "https://schema.org/InStock" });
  expect(ld.image).toEqual(["https://gorosei.gg/og/torneos/copa-semanal-12.png"]);
  expect(ld.inLanguage).toBe("es-AR");
  expect("endDate" in ld).toBe(false);
});

test("eventJsonLd: cancelled, free and closed registration", () => {
  expect(eventJsonLd(event({ status: "cancelled" })).eventStatus).toBe("https://schema.org/EventCancelled");
  expect((eventJsonLd(event({ entryFeeArs: 0 })).offers as { price: string }).price).toBe("0");
  expect((eventJsonLd(event({ status: "check_in" })).offers as { availability: string }).availability).toBe("https://schema.org/SoldOut");
});

test("jsonLdString cannot close the script tag and round-trips", () => {
  const value = { name: `</script><b> & "quoted" 'single' 🏆 ñ` };
  const out = jsonLdString(value);
  expect(out).not.toContain("<");
  expect(out).toContain("\\u003c/script>");
  expect(out).toContain("&");
  expect(out).toContain("🏆");
  expect(JSON.parse(out)).toEqual(value);
});

test("sitemapXml is well-formed and escaped", () => {
  const xml = sitemapXml(ORIGIN, [
    { path: "/", lastmod: new Date("2026-10-21T15:00:00Z") },
    { path: "/equipos/a&b<c'd", lastmod: new Date("2026-10-20T01:00:00Z") },
  ]);
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  expect(xml).toContain("<loc>https://gorosei.gg/</loc>");
  expect(xml).toContain("<lastmod>2026-10-21</lastmod>");
  expect(xml).toContain("<loc>https://gorosei.gg/equipos/a&amp;b&lt;c&apos;d</loc>");
  expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  expect(xml.match(/<url>/g)).toHaveLength(2);
});

test("sitemapXml caps the URL count", () => {
  const entries = Array.from({ length: MAX_SITEMAP_URLS + 5 }, (_, i) => ({ path: `/jugador/p${i}`, lastmod: new Date(0) }));
  expect(sitemapXml(ORIGIN, entries).match(/<url>/g)).toHaveLength(MAX_SITEMAP_URLS);
});

test("robotsTxt disallows private areas and points at the sitemap", () => {
  const txt = robotsTxt(ORIGIN);
  const lines = txt.trim().split("\n");
  expect(lines[0]).toBe("User-agent: *");
  expect(lines.filter((l) => l.startsWith("Disallow:")).sort()).toEqual(
    ["Disallow: /admin", "Disallow: /api/", "Disallow: /mod", "Disallow: /realtime"].sort(),
  );
  expect(lines).toContain("Sitemap: https://gorosei.gg/sitemap.xml");
});
