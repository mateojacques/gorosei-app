import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TwitchEmbed } from "../../src/components/tournament/twitch-embed";

test("server markup never contains an iframe; a Twitch channel renders a link", () => {
  const html = renderToStaticMarkup(<TwitchEmbed streamUrl="https://www.twitch.tv/gorosei" />);
  expect(html).not.toContain("<iframe");
  expect(html).toContain('href="https://www.twitch.tv/gorosei"');
});

test("javascript: URLs render no anchor at all", () => {
  const html = renderToStaticMarkup(<TwitchEmbed streamUrl="javascript:alert(1)" />);
  expect(html).not.toContain("<a");
  expect(html).not.toContain("javascript:");
});

test("an https link that is not Twitch renders a link but never an iframe", () => {
  const html = renderToStaticMarkup(<TwitchEmbed streamUrl="https://example.com/x" />);
  expect(html).toContain('href="https://example.com/x"');
  expect(html).not.toContain("<iframe");
});

test("an empty or http URL renders nothing linkable", () => {
  expect(renderToStaticMarkup(<TwitchEmbed streamUrl="" />)).not.toContain("<a");
  expect(renderToStaticMarkup(<TwitchEmbed streamUrl="http://example.com" />)).not.toContain("<a");
});
