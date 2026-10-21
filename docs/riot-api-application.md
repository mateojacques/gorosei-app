# Riot Developer Portal — Product Application Draft

Draft answers for registering Gorosei on https://developer.riotgames.com (Register Product → production key). Riot reviews applications in English.

## Product Name

```
Gorosei
```

Use the final brand name if it changes. The name should match the site at the Product URL.

## Product Description

```
Gorosei is a tournament platform for League of Legends focused exclusively on the LAS (Latin America South) server, with a Spanish (es-AR) interface. We run our own recurring community tournaments (at least one per week), and players use the platform to link their Riot account, form teams, register, check in, follow live brackets, and watch the streamed matches.

How we use the Riot API:

- ACCOUNT-V1 (americas): players enter their Riot ID (gameName#tagLine) to link their account; we resolve it to a PUUID. We also look up accounts by PUUID to keep Riot IDs up to date after name changes.
- SUMMONER-V4 (la2): used for ownership verification. Until we have Riot Sign On, a player proves they own an account by temporarily setting a specific default profile icon that we pick at random; we confirm the change through this endpoint. We also show summoner level on public player profiles.
- LEAGUE-V4 (la2): we read each linked player's RANKED_SOLO_5x5 rank. Rank is used for per-tournament eligibility rules (e.g. rank caps, team average limits) to keep competition fair. Because the API only returns current rank, we poll linked accounts about every 6 hours to track the highest rank we have observed this season.
- MATCH-V5 (planned): when a team provides a match ID for a tournament game, we show picks/bans, KDA, and duration on the match page.

Only players who sign up and verify ownership of their Riot account are tracked; we do not look up or store data on other players. Data is shown on public player profiles (Riot ID, level, current rank, season peak, team, tournament history).

Our goal is to move to Riot Sign On for account linking and to the Tournament API for lobby codes and automatic results. We will apply for both once this product is approved. Until then, moderators create custom lobbies manually and confirm results that team captains report.

Entry fees, where a tournament has one, are paid outside the platform and fully fund the prize pool. Payouts follow a published split, and we follow Riot's community competition guidelines. The platform has no betting, gambling, or paid features.
```

## Product Group

`Default Group`, unless collaborators need access. In that case, create a group first and pick it here.

## Product URL

**Missing.** It must be a live public URL. A landing page on our domain is enough: product name, a one-paragraph description, and a link to a privacy policy. Riot uses it to verify the product exists; `localhost` or a placeholder page will likely be rejected.

## Product Game Focus

`League of Legends`

## Are you organizing tournaments?

`Yes`. Expect follow-up questions about formats, prizes, and entry fees.

## Before submitting

- [ ] Re-read the current Riot community competition guidelines (spec §3) and make sure the description matches what we will run.
- [ ] Keep the MATCH-V5 line only if match details (spec §5.7) will be built soon; otherwise remove it.
- [ ] If the first tournaments are free, say so ("free weekly tournaments, with optional paid-entry events later").
- [ ] Product URL is live with a landing page and privacy policy.
- [ ] Rank polling interval (~6 hours) and "only linked players are tracked" still match the code.
