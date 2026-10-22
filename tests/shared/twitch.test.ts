import { expect, test } from "bun:test";
import { twitchChannel, twitchChatSrc, twitchPlayerSrc } from "../../src/shared/twitch";

test("reads the channel from Twitch channel URLs, keeping case", () => {
  expect(twitchChannel("https://www.twitch.tv/gorosei")).toBe("gorosei");
  expect(twitchChannel("https://twitch.tv/Gorosei/")).toBe("Gorosei");
  expect(twitchChannel("twitch.tv/gorosei")).toBe("gorosei");
  expect(twitchChannel("https://m.twitch.tv/gorosei?foo=1")).toBe("gorosei");
});

test("rejects anything that is not a Twitch channel", () => {
  for (const url of [
    "",
    "https://example.com/gorosei",
    "javascript:alert(1)",
    "https://www.twitch.tv/videos/123",
    "https://www.twitch.tv/gorosei/clip/x",
    "https://www.twitch.tv/a",
    `https://www.twitch.tv/${"a".repeat(26)}`,
    "https://twitch.tv.evil.com/gorosei",
    "https://www.twitch.tv/goro%22sei",
  ]) {
    expect(twitchChannel(url)).toBeNull();
  }
});

test("builds embed URLs with an encoded parent", () => {
  expect(twitchPlayerSrc("gorosei", "gorosei.gg")).toBe("https://player.twitch.tv/?channel=gorosei&parent=gorosei.gg&muted=true");
  expect(twitchChatSrc("gorosei", "gorosei.gg")).toBe("https://www.twitch.tv/embed/gorosei/chat?parent=gorosei.gg&darkpopout");
  expect(twitchPlayerSrc("gorosei", "a&b/c d")).toBe("https://player.twitch.tv/?channel=gorosei&parent=a%26b%2Fc%20d&muted=true");
  expect(twitchChatSrc("gorosei", "a&b/c d")).toBe("https://www.twitch.tv/embed/gorosei/chat?parent=a%26b%2Fc%20d&darkpopout");
});
