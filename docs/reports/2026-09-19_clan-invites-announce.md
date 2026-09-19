# 2026-09-19 — Clan invitations tab + leader announcement

## Goal

Continue draft PR #96: fix ranking coin glyphs, add a Кланы **Приглашения** tab with accept/reject, change invite chat text, and add a Leader-only clan announcement with a persisted 3-hour cooldown. Do not merge.

## Result

Ranking money rows reuse `public/ui/menu/icon_coin.png` (same asset as the menu balance). Clan invitations stay on `ClanService` with the existing 24h TTL. The menu Кланы hub always exposes **Приглашения**. Only the current Leader can open/send **Объявление соклановцам**; online members of that clan receive a turquoise system line. Cooldown is stored on the clan record.

## Implemented

- Ranking `valueLabel` is a formatted number only. GUI prepends `.mc-menu-coin` / `icon_coin.png`.
- Invite chat: `Игрок <ник> пригласил вас в клан <название>. Примите приглашение в меню` (recipient only).
- `menu_action` `clans_invitations` opens the existing accept screen even if the player is already in a clan. Rows show clan, inviter nick, remaining TTL, **Принять** / **Отклонить**.
- `reject_invitation` and `confirm_accept` re-check ownership, expiry, membership, clan existence and capacity on the server. Client `playerId` is ignored.
- Leader-only `open_announce` / `set_announce_text` / `send_announcement`. Text uses `MAX_CHAT_LENGTH` (128) and `CHAT_TOO_LONG_ERROR`. Empty text is rejected. Online members at send time get `[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] "<text>"` with `channel: clan` and `style: announcement` (`#4ecfdc`).
- Per-clan `announcementCooldownUntil` in `clans.json`. Missing field = no cooldown. Transfer keeps the clan cooldown; delete drops it with the clan. New Leader may send only after that cooldown.

## Changed files

- `shared/clans.ts`, `shared/chat.ts`, `shared/protocol.ts`
- `server/services/clan.ts`, `gameMenu.ts`, `gameMenuActions.ts`, `server/WorldInstance.ts`
- `src/ui/GameUI.ts`, `clanGui.ts`, `gameMenuGui.ts`, `src/style.css`, `src/chat/ChatLog.ts`, `src/core/Game.ts`, `src/dev/UiQaHarness.ts`
- `tests/server/clan-invites-announce.test.ts` (new), `clan.test.ts` (compat), `clan-roles-ranking.test.ts`, `clan-gui.test.ts`, `game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Protocol / actions added

- `clan_action`: `reject_invitation`, `open_announce`, `set_announce_text`, `send_announcement` (+ optional `text`, max 128)
- `menu_action`: `clans_invitations`
- `clan` screen: `announce`
- `chat`: optional `style: "announcement"`

## Cooldown / persistence

- Field: `ClanRecord.announcementCooldownUntil` (epoch ms), file `plugin-data/clans/clans.json`.
- Parse: missing/invalid → no cooldown. Invitations/roles/members unchanged.
- Authoritative on the clan, not the browser. Reload/reconnect/restart keep it.

## Invitations

- Same `invitations` map + 24h TTL + Leader/Veteran `/clan add` / `invite_by_name`.
- Menu list is `openAccept({ allowInClan: true })`. `/clan accept` still refuses if already in a clan.

## Announcement chat

- `ClanRuntime.sendMessage(..., { channel: 'clan', style: 'announcement' })` through the existing chat packet. Recipients = current `memberIds` who are online. No offline history.

## Leader / Veteran / Member

- Leader: sees the announcement button, may send (subject to cooldown).
- Veteran: no button; `send_announcement` → `CLAN_OWNER_ONLY_ERROR`. May still invite/kick members.
- Member: no button; same reject. May accept/reject their own invites.
- After transfer, new Leader gains the button; old Leader (now Veteran) loses it.

## Tests

See the closing report section after gates.

## Architecture decisions

- No second invite/announcement store or chat renderer. Style is an extra class on the existing `.chat-line`.
- Announcement `text` is a typed `clan_action` field, not `name` (name is capped at 32).
- Menu invitations reuse the clan accept screen rather than a new GameMenu screen.

## Known issues

- Offline members do not receive announcements (no chat history).
- Second announcement during cooldown is rejected even after leadership transfer (cooldown is per clan).

## Deferred

- Owner live Anarchy QA of rating/invites/announcement (this pass).

## Git

Branch `cursor/clan-roles-rating-d1a5`. Do not merge PR #96.
