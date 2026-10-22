import type { TournamentStatus } from "./tournament";

const SITE_NAME = "Gorosei";
export const MAX_SITEMAP_URLS = 50_000;

export function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export type PageMetaInput = {
  origin: string;
  path: string;
  title: string;
  description: string;
  image?: string;
  noindex?: boolean;
  type?: "website" | "article";
};

export function pageMeta(input: PageMetaInput): { meta: Record<string, string>[]; links: { rel: string; href: string }[] } {
  const url = absoluteUrl(input.origin, input.path.split(/[?#]/)[0]!);
  const meta: Record<string, string>[] = [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:url", content: url },
    { property: "og:locale", content: "es_AR" },
    { property: "og:site_name", content: SITE_NAME },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
  if (input.image) {
    const image = /^https?:\/\//.test(input.image) ? input.image : absoluteUrl(input.origin, input.image);
    meta.push({ property: "og:image", content: image }, { name: "twitter:image", content: image });
  }
  if (input.noindex) meta.push({ name: "robots", content: "noindex,follow" });
  return { meta, links: [{ rel: "canonical", href: url }] };
}

export type EventInput = {
  origin: string;
  slug: string;
  title: string;
  edition: number;
  startsAt: Date;
  status: TournamentStatus;
  entryFeeArs: number;
  prizeGoalArs: number;
  description: string;
  imageUrl: string;
};

export function eventJsonLd(input: EventInput): Record<string, unknown> {
  const url = absoluteUrl(input.origin, `/torneos/${input.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${input.title} #${input.edition}`,
    description: input.description,
    startDate: input.startsAt.toISOString(),
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: input.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    location: { "@type": "VirtualLocation", url },
    image: [input.imageUrl],
    url,
    inLanguage: "es-AR",
    organizer: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl(input.origin, "/").replace(/\/$/, "") },
    offers: {
      "@type": "Offer",
      url,
      price: String(input.entryFeeArs),
      priceCurrency: "ARS",
      availability: input.status === "registration_open" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
    },
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so the content can never close the tag. */
export function jsonLdString(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export type SitemapEntry = { path: string; lastmod: Date };

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .slice(0, MAX_SITEMAP_URLS)
    .map(
      (e) =>
        `<url><loc>${escapeXml(absoluteUrl(origin, e.path))}</loc><lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod></url>`,
    );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

// Pages that must stay out of the index carry `noindex`; crawlers only see it if they may fetch the page.
export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /mod",
    "Disallow: /api/",
    "Disallow: /realtime",
    "",
    `Sitemap: ${absoluteUrl(origin, "/sitemap.xml")}`,
    "",
  ].join("\n");
}

export const DEFAULT_OG_IMAGE = "/og/default.png";

/** For pages that must stay out of search results: personal, transactional or low-value. */
export const NOINDEX_META = { name: "robots", content: "noindex,follow" };
