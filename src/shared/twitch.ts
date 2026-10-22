const TWITCH_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv"]);
// Twitch logins are 4–25 letters, digits or underscores.
const CHANNEL = /^[A-Za-z0-9_]{4,25}$/;
const RESERVED = new Set(["videos", "directory", "search", "settings", "downloads", "subscriptions", "inventory", "wallet", "drops", "jobs", "turbo", "prime"]);

export function twitchChannel(streamUrl: string): string | null {
  const raw = streamUrl.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!TWITCH_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const channel = segments[0]!;
  if (!CHANNEL.test(channel) || RESERVED.has(channel.toLowerCase())) return null;
  return channel;
}

export function twitchPlayerSrc(channel: string, parent: string): string {
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&muted=true`;
}

export function twitchChatSrc(channel: string, parent: string): string {
  return `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`;
}
