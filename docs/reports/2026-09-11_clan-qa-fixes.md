# 2026-09-11 — Clan QA fixes

## Goal

Fix live Anarchy QA issues on PR #85 without changing agreed clan rules: dim create button, missing invite chat, join-request button while invited, makeleader→leave→create blocked, gold trophies on every row, ranking name alignment.

## Result

All four bugs plus ranking alignment are fixed on `cursor/clan-system-a8dc`. Auction House / EconomyService unchanged except existing `CLAN_CREATE` reason.

## Root cause: makeleader → leave → create

Membership `memberIds` after leave was already correct (`playerClan(A)` is undefined; B remains owner). The live failure was a **stale create draft**: `session.nameText` still held the old clan name, so `/clan create` prefilled it and `confirm_create` failed with `CLAN_NAME_TAKEN` until B deleted the clan (freeing the name). That looked like leftover membership.

Fixes:

- `openCreate` clears name/icon unless the player is already on the create screen.
- `leave` / `kick` / `delete` call `detachFromClans` + `clearCreateDraft`.
- Same-name create still correctly fails while the old clan exists; a **new** name succeeds immediately.

## Implemented

- Create button: `.mc-clan-btn-2line` darker/bolder text; disabled still distinct. Other `.mc-ah-btn` unchanged.
- Invite chat via `ClanRuntime.sendMessage` only when a new invitation is stored.
- `joinState: invited` from server invitation lookup; card button «Вступить в клан» → accept-confirm; expired invite on click → error + card refresh.
- Ranking: CSS cups gold/silver/bronze (no 🏆 emoji); `.mc-clan-rank-col` fixed width; page 2 keeps global ranks 7+.

## Tests

Regression: former owner create after makeleader+leave; persist/reload then create; invite chat once; card invited accept; expired card join; rank column / invited caption; plugin makeleader leave create + card accept.

Focused: clan 19/19, clan-plugin 7/7, clan-gui 6/6, auction 24/24, auction-plugin 9/9, auction-gui 6/6, economy 15/15. `test:server` **43 files / 446 tests PASS**. Four typechecks, `check:boundaries`, and `build` PASS.

## Git

Same PR https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/85
