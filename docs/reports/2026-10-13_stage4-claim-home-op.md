# Stage 4 follow-up — claims, homes, and env OP

Date: 2026-10-13

## Goal

Stop a chosen nickname from owning a claim, acting as a trusted member, or reading another player's homes. Stop `FC_OPERATORS` from staying OP after it is removed from the environment.

## Root cause

`claims.ts` stored `owner` and `members` as lowercased nicknames and treated a matching name as trust. The claim menu deleted by `session.claimId` without checking the owner again. `HomeService.ownerKey` was the nickname, and commands and the home menu passed `player.name`. `PermissionService.load` copied env operator ids into the same set as manual `/op` and wrote that set back, so a later restart without the env entry still loaded the id from JSON.

## Result

New claims and new members store the server player id. A nickname match is not ownership and not trust. Clan owners stay `clan:<id>`. The event claim stays `__world_events__`. Old nickname owners and members remain on disk and keep the claim protected, but they do not authorize anyone until the console runs `claim migrate-owner` or `claim migrate-member`. Those commands require a real player id. Repeating them does not duplicate members or change flags.

New homes are stored by player id. Old nickname lists move to `legacy` on load and are invisible to a matching nick. `home migrate` copies them only when no home name would be overwritten. The home menu uses the same id.

Manual OP is the only OP written to `permissions.json`. Current `FC_OPERATORS` ids are checked in memory and are not saved. Removing an env-only id and restarting removes that OP. An explicit `/op` remains. `/deop` refuses while the env entry is still present. Older saved `ops` whose source cannot be known move to `unreviewedOps` and do not grant OP until the console runs `/op` again.

Stage 4 admin HTTP was not changed.

## Validation

| Check | Result |
| --- | --- |
| `tests/server/stage4-ownership.test.ts` | PASS, 2 tests |
| PermissionService env/manual split, homes legacy migrate, claim anchors, Stage 4 privilege and HTTP | PASS |
| `tsc`, client, server, import boundaries | PASS |
| `git diff --check` | PASS after removing a trailing blank line |
| `npm run typecheck:sim` | FAIL. Unchanged DOM and `virtual:player-skin-content-hashes` errors |
| Full Vitest, no database URL | 26 failed, 3544 passed, 52 skipped, 398 files |
| PostgreSQL integration | NOT RUN |
| Client build | PASS, `dist/assets/index-C_duKjOB.js` |
| Server build and production smoke | PASS. Anarchy, survival, peaceful, SIGTERM 0 |
| Manual QA and GitHub Actions | NOT RUN |

The 26 names match the previous Stage 4 baseline. One earlier full run also failed `anarchy-plugins` claim member text, `auto-mine` delete, and a skeleton-arrow case. The claim text expected the old nickname member; it now expects the player id and passed on rerun. The other two passed on a separate rerun and are not in this 26.

## Performance

No new SQL and no player scan on the 20 TPS tick. Claim checks compare ids. Home lookup is a map by player id. Nickname resolution runs only for an explicit member or migrate command.

## Git

- Branch `cursor/admin-antidupe-postgres-foundation-26a8`
- `origin/main`: `78eb6f338349be32d6ecf63ba40f900020b203a2` (5 commits not merged)
- Feature HEAD before: `a58b86ea293b02db36c6295c0d9f489ad9fc5513`
- Draft PR **#129**. Not merged.
