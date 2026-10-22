// Data Dragon is Riot's static CDN: profile icon images live under a game version.
const DDRAGON_HOST = "https://ddragon.leagueoflegends.com";
const CACHE_MS = 6 * 60 * 60 * 1000;

// The default icons we ask for (0..28) exist in every version, so an old one still shows the right image.
export const FALLBACK_DDRAGON_VERSION = "15.1.1";

export function profileIconUrl(version: string, iconId: number): string {
  return `${DDRAGON_HOST}/cdn/${version}/img/profileicon/${iconId}.png`;
}

export function createDdragon(opts: { fetch?: typeof fetch; now?: () => number } = {}) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { version: string; at: number } | null = null;

  async function latestVersion(): Promise<string> {
    if (cached && now() - cached.at < CACHE_MS) return cached.version;
    try {
      const res = await doFetch(`${DDRAGON_HOST}/api/versions.json`, { signal: AbortSignal.timeout(3000) });
      const versions: unknown = res.ok ? await res.json() : null;
      const [latest] = Array.isArray(versions) ? versions : [];
      if (typeof latest !== "string") return FALLBACK_DDRAGON_VERSION;
      cached = { version: latest, at: now() };
      return latest;
    } catch {
      return FALLBACK_DDRAGON_VERSION;
    }
  }

  return { latestVersion };
}

export const ddragon = createDdragon();
