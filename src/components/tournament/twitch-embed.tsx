import { useEffect, useState } from "react";
import { t } from "@/shared/i18n";
import { twitchChannel, twitchChatSrc, twitchPlayerSrc } from "@/shared/twitch";

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The tournament stream. The server renders only a link; the player and chat iframes mount on the client,
 * because Twitch requires `parent` to be the page's own hostname.
 */
export function TwitchEmbed({ streamUrl }: { streamUrl: string }) {
  const channel = twitchChannel(streamUrl);
  const link = httpsUrl(streamUrl) ?? (channel ? `https://www.twitch.tv/${channel}` : null);
  const [parent, setParent] = useState<string | null>(null);
  useEffect(() => {
    if (channel) setParent(window.location.hostname);
  }, [channel]);

  if (!link) return null;
  return (
    <div className="flex flex-col gap-3">
      {channel && parent && (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="aspect-video w-full bg-surface-raised lg:flex-[2]">
            <iframe
              src={twitchPlayerSrc(channel, parent)}
              title={t("stream.playerTitle", { channel })}
              loading="lazy"
              allowFullScreen
              className="size-full"
            />
          </div>
          <div className="h-[26rem] w-full bg-surface-raised lg:h-auto lg:flex-1">
            <iframe src={twitchChatSrc(channel, parent)} title={t("stream.chatTitle", { channel })} loading="lazy" className="size-full" />
          </div>
        </div>
      )}
      <p>
        <a href={link} rel="noopener noreferrer" target="_blank" className="font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink">
          {channel ? t("stream.watchOnTwitch", { channel }) : t("stream.watch")}
        </a>
      </p>
    </div>
  );
}
