# Stage 4 follow-up — permissions follow the player id

Date: 2026-10-13

## Goal

Stop a chosen nickname from receiving operator rights, roles, or privileged permission nodes. Leave the private admin HTTP listener as it is.

## Root cause

`PermissionService` stored operators, `playerRoles`, and `playerPermissions` under a lowercased string. `WorldInstance` passed a resolver that turned a server `playerId` into the current display name before that lookup. Command checks then called `isOperator(sender.name)` or `has(player.name)` as well as the id. `FC_OPERATORS` was copied into the same set, so the nickname `Op` made whoever joined as `Op` an operator.

The same name path was used by `/op`, `/permissions grant`, `/permissions role assign`, and builtin checks for plugins, economy, claims admin, holograms, homes limits, automine, duels, and the boss.

## Result

The subject of a player permission is the server-issued player id. A nickname is not a key. `has` and `isOperator` do not fall back to the display name. `/op`, `/deop`, grant, revoke, and role assign resolve a target to one online or stored id and then store only that id. Zero matches and several matches are rejected. Nothing is created under the nickname.

`FC_OPERATORS` / `OPERATORS` grant OP only when the entry is a player id. A nickname is counted in the startup log and ignored.

An old `permissions.json` without version 2 is split on load. Keys that are player ids stay active. Nickname keys move to `legacy` and stay there across restart. Role definitions are kept. `/permissions migrate <legacy-name> <playerId>` moves one legacy entry onto a confirmed id. The second argument must be the id. A matching nickname is not accepted as that confirmation.

Default role nodes still apply to every player. Stage 4 login, cookies, and the loopback listener were not changed.

Claim parcels and homes still remember the display name they were saved with. That is not a permission node. `claim.admin` itself is checked on the player id.

## Validation

| Check | Result |
| --- | --- |
| Privilege tests `tests/server/stage4-privilege.test.ts` | PASS, 2 tests |
| PermissionService, console nickname, Stage 4 auth/HTTP/lifecycle, admin action/inspection | PASS |
| `tsc`, client, server, import boundaries, `git diff --check` | PASS |
| `npm run typecheck:sim` | FAIL. Same unchanged DOM and `virtual:player-skin-content-hashes` errors as Stage 4 |
| Full Vitest, no database URL | 26 failed, 3540 passed, 52 skipped, 397 files |
| PostgreSQL integration | NOT RUN |
| Client build | PASS, `dist/assets/index-C_duKjOB.js` |
| Server build and production smoke | PASS. Anarchy, survival, peaceful, SIGTERM 0 |
| Manual QA and GitHub Actions | NOT RUN |

The 26 failures are the same client and combat names as the Stage 4 run (26 failed, 3537 passed, 52 skipped, 396 files). This run adds the privilege file and its 2 passing tests, plus one PermissionService case.

## Performance

Permission checks are a map lookup by player id. Resolving a command target walks online and stored players only when an operator command asks. The 20 TPS tick does not scan them and does not query PostgreSQL. No new process or listener.

## Git

- Branch `cursor/admin-antidupe-postgres-foundation-26a8`
- `origin/main`: `78eb6f338349be32d6ecf63ba40f900020b203a2` (5 commits not in this branch; not merged)
- Feature HEAD before: `5ce311d327e483c1681a18585c9406177baa15cb`
- Permission follow-up: `248317c7b0135317bb4033a65cf5f953af97549f`
- After this report line the branch is 43 ahead of `2dd09ee` and 5 behind `origin/main`
- Draft PR **#129**. Not merged.
