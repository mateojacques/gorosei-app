export type RiotId = { gameName: string; tagLine: string };

const MAX_GAME_NAME_LENGTH = 16;
const MIN_TAG_LENGTH = 3;
const MAX_TAG_LENGTH = 5;

// Lengths count Unicode code points so accented names are measured like Riot does.
const length = (s: string) => [...s].length;

export function parseRiotId(input: string): RiotId | null {
  const hash = input.lastIndexOf("#");
  if (hash === -1) return null;
  const gameName = input.slice(0, hash).trim();
  const tagLine = input.slice(hash + 1).trim();
  if (gameName === "" || length(gameName) > MAX_GAME_NAME_LENGTH) return null;
  if (length(tagLine) < MIN_TAG_LENGTH || length(tagLine) > MAX_TAG_LENGTH) return null;
  return { gameName, tagLine };
}

export function formatRiotId(id: RiotId): string {
  return `${id.gameName}#${id.tagLine}`;
}

export function riotIdToSlug(id: RiotId): string {
  return encodeURIComponent(`${id.gameName}-${id.tagLine}`);
}

export function slugToRiotId(slug: string): RiotId | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const dash = decoded.lastIndexOf("-");
  if (dash <= 0 || dash === decoded.length - 1) return null;
  return { gameName: decoded.slice(0, dash), tagLine: decoded.slice(dash + 1) };
}
