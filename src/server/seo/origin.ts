/** The public site origin: the origin of BETTER_AUTH_URL (no new env var). */
export function siteOrigin(authUrl: string): string {
  return new URL(authUrl).origin;
}

/** The configured site origin, for server functions that return it alongside page data. */
export async function configuredSiteOrigin(): Promise<string> {
  const { env } = await import("../env");
  return siteOrigin(env.BETTER_AUTH_URL);
}
