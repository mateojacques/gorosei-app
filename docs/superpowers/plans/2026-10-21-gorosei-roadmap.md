# Gorosei MVP — Plan Roadmap

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md`

The MVP spans several independent subsystems, so it is split into sequential plans. Each produces working, tested software on its own. Only the next plan is written in full detail; later plans are written when their turn comes, against the code that exists by then.

| # | Plan | Covers (spec §) | Depends on |
|---|------|-----------------|------------|
| 1 | **Foundation & identity** — `2026-10-21-plan-1-foundation-identity.md` | App scaffold, DB, i18n, auth (Discord/email), Riot client, Riot ID verification, rank tracking (current + observed peak), overrides, audit log, minimal profile page (§3, §5.1, §5.4 rank source, §5.9 partial, §6) | — |
| 2 | **Visual identity & design system** | Distinctive identity via the `impeccable` skill: typography, color, layout language, core components; restyle Plan 1 pages. Anti-goal: no generic card grids / purple gradients (§2, §6) | 1 |
| 3 | **Tournaments, teams & registration** — `2026-10-21-plan-3-tournaments-teams-registration.md` | Tournament model + lifecycle, eligibility rule engine + rank snapshots, teams/invites/join requests, registration, admin payment marking, confirmation (5 paid), entry credits, cap slots, cancellation (§5.2–5.4) | 1, 2 |
| 4 | **Free-agent pool** — `2026-10-22-plan-4-free-agent-pool.md` | Pool entry (pre-paid), role preferences, hand-pick / recruit, auto-placement at registration close, captain assignment, unplaced → credit (§5.5) | 3 |
| 5 | **Match day** — `2026-10-22-plan-5-match-day.md` | Check-in (1h before, subs, ≥3 short-handed, forfeit), bracket via brackets-manager (DE w/ reset, SE w/ 3rd place), match flow, captain reports + moderator confirm, disputes, match chat over WebSockets, moderator console, match stats from match ID (§5.6, §5.7, §5.10, §5.11 moderator console) | 3 |
| 6 | **Tournament page, browse & SEO** — `2026-10-22-plan-6-tournament-page-browse-seo.md` | Stage-aware tournament page (before/during/after), Twitch embed + chat, live bracket view, browse page, team profiles, full player profile, OG images, sitemap, schema.org `Event` (§5.2, §5.8, §5.9, §6) | 2, 3, 5 |
| 7 | **Automation & notifications** | Recurring templates auto-creating editions, in-app + email notifications, Riot-approved feature flags (RSO, tournament codes, result callbacks) (§5.10–5.12) | 3–6 |

Launch gate (spec §3): public launch waits for a Riot production API key.
