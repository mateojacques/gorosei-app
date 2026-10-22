import { expect, test } from "bun:test";
import { renderNotificationEmail } from "../../../src/server/email/render";
import { notificationText } from "../../../src/shared/notifications";

const origin = "https://gorosei.gg";
const hostile = { kind: "team_invite" as const, teamName: `<script>alert(1)</script> & "x"`, tournament: null };

test("the subject is the notification title and both bodies link back", () => {
  const payload = { kind: "payment_recorded" as const, tournament: { title: "Copa", edition: 3, slug: "copa-3" } };
  const email = renderNotificationEmail(payload, origin);
  expect(email.subject).toBe(notificationText(payload).title);
  for (const body of [email.text, email.html]) {
    expect(body).toContain("https://gorosei.gg/torneos/copa-3");
    expect(body).toContain("https://gorosei.gg/notificaciones");
  }
});

test("team names are escaped in html and raw in text", () => {
  const email = renderNotificationEmail(hostile, origin);
  expect(email.html).not.toContain("<script");
  expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
  expect(email.text).toContain(hostile.teamName);
});
