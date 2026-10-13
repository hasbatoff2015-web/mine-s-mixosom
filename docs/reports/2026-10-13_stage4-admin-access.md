# Stage 4 — private access for two equal administrators

Date: 2026-10-13

## Goal

Authenticate exactly two equal administrators on a private loopback HTTP listener. Do not build the admin panel, admin writes, or backups.

## Result

`FC_ADMIN_PORT` starts a second HTTP listener in the existing Node process. It binds `127.0.0.1` only. Login maps a high-entropy token to one `FC_ADMIN_IDS` entry. The session is server-owned, short-lived, and carried in an HttpOnly cookie. Logout requires the loopback Origin and a session CSRF token. Player inspection reuses `AdminInspectionService`. The public gameplay listener is unchanged. Without `FC_ADMIN_PORT`, startup is unchanged.

`origin/main` moved to `78eb6f338349be32d6ecf63ba40f900020b203a2` (PR #130, five commits). This branch was not merged with that work.

## Initial security audit

`AdminIdentityPolicy.requireAdmin` only checks that a string is one of the two configured ids. It does not prove who sent the string. `AdminActionService` and `AdminInspectionService` already refuse unknown ids, idempotency, and audit, but nothing on the network called them. The public `AnarchyServer` HTTP handler serves `/status` with `Access-Control-Allow-Origin: *` and upgrades WebSocket. A body field `adminId` would have been enough if those services had been mounted there.

Game nicknames, `sessionToken`, `/op`, and `FC_OPERATORS` are a different identity system. Authentication belongs on a separate listener that derives `adminId` from a credential or a server session. The existing policy, action service, and inspection service stay the authorization core. No second audit database was added.

## Implementation

- `scripts/provision-admin-credentials.mjs` (`npm run admin:provision`) prints two `node:crypto` tokens of 32 bytes and `FC_ADMIN_AUTH_HASHES`. It does not write a file.
- `FC_ADMIN_AUTH_HASHES` is `id:sha256hex,id:sha256hex`. Both ids must match `FC_ADMIN_IDS`. Digests must be unique 64-character lowercase hex. The blank-string digest is rejected. A missing port leaves the listener off. A port without both ids or both hashes fails startup.
- `resolveAdminCredential` hashes the presented token and compares both digests with `timingSafeEqual`. Secrets shorter than 43 characters are rejected. The client `adminId` is not an argument.
- `AdminSessionStore` keeps at most 16 sessions. Idle timeout is 30 minutes. Absolute lifetime is 8 hours. Restart clears them because they are not stored.
- Cookie `fc_admin_session` is `HttpOnly`, `SameSite=Strict`, `Path=/admin`. `Secure` is set only when the socket itself is TLS. Loopback HTTP over an SSH tunnel does not set it, and the bind is not opened to obtain that flag.
- Logout and other state-changing routes require `Origin` of `http://127.0.0.1:<port>` or `http://localhost:<port>` on plain HTTP, plus `X-CSRF-Token` equal to the session token. Login allows a missing Origin so a tunnel client can sign in, and rejects any other Origin. `Host` must be the loopback host and the bound port. `X-Forwarded-Host` is ignored.
- Login failures share one bounded counter: 8 per 60 seconds, then HTTP 429. Logs for rejection, expiry, and denial are at most one line per minute and do not include the token, hash, cookie, or CSRF token.
- Routes: `POST /admin/api/login`, `POST /admin/api/logout`, `GET /admin/api/me`, `GET /admin/api/player/:playerId`. Inspection passes the session's admin id into the existing service. `adminActionFromContext` is the future write adapter: it discards a client admin id. No write route calls it.
- The admin listener starts before world load. A taken port throws, does not fall back to `0.0.0.0`, and does not write `meta.json`, `world.json`, or `players.json`. Shutdown clears sessions and closes the listener, including leftover sockets.

## Security boundaries

- No admin route on the public gameplay listener.
- A nickname equal to an admin id stays a normal player. Game nicknames allow only `A–Z` and `0–9`, so `admin-owner` cannot be typed as a nick; `AdminOwner` can, and that nick still cannot log in.
- A gameplay `sessionToken` is not an admin cookie.
- A client `adminId` does not choose the session.
- Both configured admins pass the same checks. There is no rank field.
- Tokens and digests are absent from `/status`, admin JSON, and the login log line.

## Gameplay

Ordinary join, `/status`, and WebSocket are unchanged. Login, logout, and `/me` do not change inventory, balance, auction holding listings, or the buyer list. Shared protocol files were not edited. The 20 TPS tick does not call admin HTTP or PostgreSQL. No SQL connection is opened because `FC_ADMIN_PORT` is set. There is no new process and no new migration.

## Tests

`tests/server/stage4-admin-auth.test.ts`, `stage4-admin-http.test.ts`, and `stage4-admin-lifecycle.test.ts` cover both logins, forged ids, nickname and game-token rejection, loopback bind, missing CORS, bad Host, malformed and oversized bodies, method rejection, the 8-failure rate limit, HttpOnly/SameSite cookies, idle and absolute expiry, logout, CSRF, Origin, the session cap, restart, two mode ports, public `/admin` 404, occupied port without a snapshot, and equal inspection. Existing admin identity, action, and inspection tests still pass.

## Validation

| Check | Result |
| --- | --- |
| Stage 4 auth, HTTP, lifecycle | PASS, 14 tests |
| Admin identity, action, inspection | PASS |
| `tsc`, `tsc -p tsconfig.client.json`, `tsc -p tsconfig.server.json` | PASS |
| `npm run typecheck:sim` | FAIL. Unchanged files: `document` / canvas names in `src/entities/voxelVisuals.ts` and `src/rendering/TextureAtlas.ts`, plus missing `virtual:player-skin-content-hashes`. This stage did not edit them. |
| Import boundaries | PASS |
| `git diff --check` | PASS |
| Full Vitest, `FC_TEST_DATABASE_URL` unset | 26 failed, 3537 passed, 52 skipped, 396 files |
| PostgreSQL integration | NOT RUN. `FC_TEST_DATABASE_URL` is unset and `psql` is not installed. |
| Client build | PASS. `dist/assets/index-C_duKjOB.js` (same hash as Stage 3C; no client change) |
| Server build and `smoke:server:prod` | PASS. Anarchy, survival, and peaceful ready, SIGTERM 0, lock removed. |
| Manual QA | NOT RUN. Planned after Stage 6. |
| GitHub Actions | NOT RUN |

The 26 full-suite failures are the previous client and combat names: arrow visuals, classic combat, fence jump, menu screenshot, god-sword texture, SFX pack, remote breaking overlays, ui-main, god-sword mob, pet hit registration, and bow draw. Stage 3C's full run was 26 failed, 3523 passed, 52 skipped, 393 files. This run adds the 3 Stage 4 files and 14 passing tests. `auto-mine` and `tick-load-flight` did not fail.

## Known limits

Stage 5 still has to choose which writes exist. `AdminActionService` is not mounted. The duplicate-item guard from Stage 3B is unchanged. Sessions die on restart. A leaked token is revoked by replacing that one hash and restarting. The listener must stay off the public firewall; Host checks are not a substitute for that.

## Git

- Branch `cursor/admin-antidupe-postgres-foundation-26a8`
- `origin/main`: `78eb6f338349be32d6ecf63ba40f900020b203a2` (5 commits not in this branch; not merged)
- Feature HEAD before: `a1fef6291d0a41da9aae4b98062a0ff2126fe814`
- Draft PR **#129**. Not merged.
