import { t } from "../../shared/i18n";
import { notificationHref, notificationText, type NotificationPayload } from "../../shared/notifications";
import type { EmailMessage } from "./mailer";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain text and a minimal HTML version of one notification; every interpolated value is escaped in the HTML. */
export function renderNotificationEmail(payload: NotificationPayload, origin: string): Omit<EmailMessage, "to"> {
  const { title, body } = notificationText(payload);
  const link = `${origin}${notificationHref(payload)}`;
  const settings = `${origin}/notificaciones`;
  const text = [title, "", body, "", `${t("email.open")}: ${link}`, "", "--", t("email.footer", { link: settings })].join("\n");
  const html = `<!doctype html>
<html lang="es-AR">
<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px">${escapeHtml(body)}</p>
<p style="margin:0 0 28px"><a href="${escapeHtml(link)}" style="color:#111111;font-weight:bold">${escapeHtml(t("email.open"))}</a></p>
<p style="margin:0;font-size:13px;color:#555555">${escapeHtml(t("email.footerLead"))} <a href="${escapeHtml(settings)}" style="color:#555555">${escapeHtml(settings)}</a></p>
</body>
</html>`;
  return { subject: title, text, html };
}
