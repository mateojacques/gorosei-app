import { formatDateTime, type MessageKey, t } from "./i18n";

export type TournamentRef = { title: string; edition: number; slug: string };
export type CreditReason = "unconfirmed" | "waitlisted" | "unplaced" | "cancelled" | "manual";

export type NotificationPayload =
  // `tournament` is set for free-agent pool invites and requests.
  | { kind: "team_invite"; teamName: string; tournament: TournamentRef | null }
  | { kind: "join_request"; teamName: string; playerRiotId: string; tournament: TournamentRef | null }
  | { kind: "request_accepted"; teamName: string; teamSlug: string }
  | { kind: "payment_recorded"; tournament: TournamentRef }
  | { kind: "registration_confirmed"; teamName: string; tournament: TournamentRef }
  | { kind: "auto_placed"; teamName: string; teamSlug: string; teammates: string[]; captain: boolean; tournament: TournamentRef }
  | { kind: "credit_granted"; reason: CreditReason; tournament: TournamentRef | null }
  | { kind: "check_in_open"; tournament: TournamentRef; closesAt: string }
  | { kind: "check_in_reminder"; tournament: TournamentRef; missing: number; closesAt: string }
  | { kind: "match_ready"; tournament: TournamentRef; matchId: string; opponent: string }
  // `score` is the recipient's side first.
  | { kind: "result_confirmed"; tournament: TournamentRef; matchId: string; won: boolean; score: [number, number] }
  | { kind: "match_disputed"; tournament: TournamentRef; matchId: string };

export type NotificationKind = NotificationPayload["kind"];

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/** How long after creation a notification is still worth emailing. */
export const EMAIL_TTL_MS: Record<NotificationKind, number> = {
  team_invite: WEEK_MS,
  join_request: WEEK_MS,
  request_accepted: WEEK_MS,
  payment_recorded: WEEK_MS,
  registration_confirmed: WEEK_MS,
  auto_placed: WEEK_MS,
  credit_granted: WEEK_MS,
  check_in_open: HOUR_MS,
  check_in_reminder: HOUR_MS,
  match_ready: HOUR_MS,
  result_confirmed: WEEK_MS,
  match_disputed: WEEK_MS,
};

/** Accounts created through Riot Sign On get an address on this domain; it is never emailed. */
export const NO_EMAIL_DOMAIN = "riot.invalid";

const cupName = (ref: TournamentRef) => t("notification.cup", { title: ref.title, edition: ref.edition });

export function notificationHref(p: NotificationPayload): string {
  switch (p.kind) {
    case "team_invite":
    case "join_request":
      return p.tournament ? `/torneos/${p.tournament.slug}/agentes-libres` : "/mis-equipos";
    case "request_accepted":
    case "auto_placed":
      return `/equipos/${p.teamSlug}`;
    case "credit_granted":
      return p.tournament ? `/torneos/${p.tournament.slug}` : "/torneos";
    case "payment_recorded":
    case "registration_confirmed":
    case "check_in_open":
    case "check_in_reminder":
      return `/torneos/${p.tournament.slug}`;
    case "match_ready":
    case "result_confirmed":
    case "match_disputed":
      return `/partidas/${p.matchId}`;
  }
}

export function notificationText(p: NotificationPayload): { title: string; body: string } {
  const text = (title: MessageKey, body: MessageKey, params: Record<string, string | number> = {}) => ({
    title: t(title, params),
    body: t(body, params),
  });
  switch (p.kind) {
    case "team_invite":
      return p.tournament
        ? text("notification.team_invite.title", "notification.team_invite.bodyPool", { team: p.teamName, cup: cupName(p.tournament) })
        : text("notification.team_invite.title", "notification.team_invite.body", { team: p.teamName });
    case "join_request":
      return p.tournament
        ? text("notification.join_request.title", "notification.join_request.bodyPool", {
            team: p.teamName,
            player: p.playerRiotId,
            cup: cupName(p.tournament),
          })
        : text("notification.join_request.title", "notification.join_request.body", { team: p.teamName, player: p.playerRiotId });
    case "request_accepted":
      return text("notification.request_accepted.title", "notification.request_accepted.body", { team: p.teamName });
    case "payment_recorded":
      return text("notification.payment_recorded.title", "notification.payment_recorded.body", { cup: cupName(p.tournament) });
    case "registration_confirmed":
      return text("notification.registration_confirmed.title", "notification.registration_confirmed.body", {
        team: p.teamName,
        cup: cupName(p.tournament),
      });
    case "auto_placed":
      return text(
        "notification.auto_placed.title",
        p.captain ? "notification.auto_placed.bodyCaptain" : "notification.auto_placed.body",
        { team: p.teamName, teammates: p.teammates.join(", "), cup: cupName(p.tournament) },
      );
    case "credit_granted":
      return text("notification.credit_granted.title", `notification.credit_granted.body.${p.reason}`, {
        cup: p.tournament ? cupName(p.tournament) : t("notification.aCup"),
      });
    case "check_in_open":
      return text("notification.check_in_open.title", "notification.check_in_open.body", {
        cup: cupName(p.tournament),
        closesAt: formatDateTime(new Date(p.closesAt)),
      });
    case "check_in_reminder":
      return text("notification.check_in_reminder.title", "notification.check_in_reminder.body", {
        cup: cupName(p.tournament),
        missing: t(p.missing === 1 ? "notification.missingOne" : "notification.missingMany", { count: p.missing }),
        closesAt: formatDateTime(new Date(p.closesAt)),
      });
    case "match_ready":
      return text("notification.match_ready.title", "notification.match_ready.body", {
        opponent: p.opponent,
        cup: cupName(p.tournament),
      });
    case "result_confirmed":
      return text(
        p.won ? "notification.result_confirmed.titleWon" : "notification.result_confirmed.titleLost",
        "notification.result_confirmed.body",
        { score: `${p.score[0]}-${p.score[1]}`, cup: cupName(p.tournament) },
      );
    case "match_disputed":
      return text("notification.match_disputed.title", "notification.match_disputed.body", { cup: cupName(p.tournament) });
  }
}
