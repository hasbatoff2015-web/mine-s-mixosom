# Clan base point — 2026-09-20

## Goal

Add one persistent clan base point per clan: a diamond private claim at the leader’s standing block, 24h move cooldown, and teleport for current members. Continue draft PR #96. Do not merge.

## Result

A clan can have at most one active diamond base. Leader sets/moves it from the current server position. Members teleport onto the diamond. Access follows live clan membership. Existing diamond claim geometry, protection, and TeleportService are reused.

## Implemented

- Protocol: `clan_action` `set_base` / `teleport_to_base`. Card fields: `hasBase`, `baseLabel`, `canSetBase`, `setBaseLabel`, `setBaseDisabled`, `baseCooldownUntil`, `baseCooldownLabel`, `canTeleportToBase`.
- Persistence: `ClanRecord.base` `{ worldId, x, y, z, claimId }` and `baseCooldownUntil`. Missing `base` loads as unset.
- Claim: programmatic diamond block-claim with `clanId`, owner `clan:<clanId>`, volume from `CLAIM_ANCHOR_RADIUS.diamond_block` (30). Claims plugin trusts `claim.clanId` via `ClanService.isClanMember`.
- Overlap: `overlappingClaims` against **all** claims (personal, `/claim`, other clan bases). Failure does not start cooldown and does not delete the old base.
- Bedrock: never replaced; try one block above.
- Move: validate new first; then delete old diamond claim+block, place new, start 24h cooldown.
- Clan delete removes the claim and the diamond block.
- GUI «Мой клан»: status line, leader set/change opens a confirmation (`set-base-confirm`, Подтвердить/Отмена); install runs only on confirm from the live player position. Teleport if a base exists.

## Changed files

- `shared/clans.ts`, `shared/protocol.ts`
- `server/services/clan.ts`, `server/services/clanBase.ts`, `server/services/claims.ts`, `server/services/claimAnchors.ts`, `server/services/teleport.ts`
- `server/WorldInstance.ts`, `server/builtin-plugins/claims.ts`
- `src/ui/GameUI.ts`, `src/style.css`
- `tests/server/clan-base.test.ts`, `tests/server/claim-anchors.test.ts`, `tests/clan-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report

## Architecture decisions

- No second claim system. Clan base is a diamond block-claim tagged with `clanId`.
- Access is membership lookup, not a copied UUID list, so join/leave/kick/role changes stay correct without extra sync.
- Cooldown lives on the clan (`baseCooldownUntil`), not on the leader and not only inside `base`, so a destroyed diamond still keeps the 24h gate.
- Client cannot choose coordinates or clanId for install: server uses the acting player, their clan, role, and live position.

## Tests

Focused: leader set, member denied, overlap (own `/claim` volume), bedrock, teleport dest, cooldown persist via `clan.load()`, protocol allowlist. Plus typecheck and build.

## Visual QA

Not run as a long live pass. Overlay click handling for the new buttons uses the existing `data-clan-action` path (disabled buttons ignored).

## Performance

Unchanged: one extra claim row per clan that has a base.

## Known issues

None observed in focused tests.

## Deferred

Owner live Anarchy QA of place/move/teleport in the running game.

## Next work

Owner review of draft PR #96. Do not merge without that review.

## Git

Branch `cursor/clan-roles-rating-d1a5`. Draft PR #96. No merge.
