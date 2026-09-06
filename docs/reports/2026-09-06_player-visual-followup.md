# 2026-09-06 — Player visual follow-up after PR #64

## Goal

Keep PR #64 (air swing, hurtSeq, crouch hierarchy, protocol armor ids). Remove the unusable inflated armor overlay. Crouch so the torso leans over the legs instead of translating forward. Reuse the singleplayer eat/drink held-item bobble in multiplayer. Make the player damage flash as contrasty as the mob flash.

## Result

Follow-up on `cursor/armor-crouch-swing-flash-3f93`. No new protocol, no new animator, no replacement armor renderer.

## Implemented

1. **Armor visual removed.** Deleted `src/rendering/player/playerArmor.ts` and all `PlayerVisual.setArmor` / overlay attach paths. `Game` and `RemotePlayerView` no longer drive meshes from equipment. `Inventory.armor`, armor items, HUD armor points, and `presentation.armor` remain.

2. **Crouch hip.** Sneak pose keeps `bodyPitch ≈ -0.48` around `upperBody` at y = 12px. `bodyYOffset` and `bodyZOffset` are 0 so the hip stays over the legs. Feet world XZ do not move. Head/arms/held item stay children of `upperBody`.

3. **Eat/drink.** Extracted `applyEatDrinkHeldItemPose` from first-person (same cadence/settle numbers). `PlayerVisual` resets the held-item base transform each frame, then applies the pose while `foodUseProgress > 0`. Potions are food-kind and share the pose. Online local progress is `own player_state.presentation.foodUseProgress` because `session.foodUseTicks` stays 0 in `tickOnline`. Remotes already passed `foodUseProgress` into the animator.

4. **Hurt flash.** Model tint is `applyMobHurtTint` with `playerHurtFlashIntensity` (peak 1.0, 220 ms). HUD overlay remains `hurtFlashAlpha` peak 0.28. Local third-person uses `HurtFeedback.modelIntensity`; remotes still use `hurtSeq` → `triggerHurtFlash`. Own snapshot `hurtSeq` also retriggers the local model flash.

5. **Air swing** — not changed. Discrete `{ type: 'attack' }` still sent on every click, including misses.

## Changed files

- Deleted `src/rendering/player/playerArmor.ts`
- `src/rendering/player/PlayerVisual.ts` — no overlay; eat pose; mob tint
- `src/rendering/player/PlayerVisualAnimator.ts` — sneak offsets 0
- `src/rendering/heldItemEatPose.ts` — shared bobble
- `src/rendering/FirstPersonRenderer.ts` — uses shared bobble
- `src/rendering/hurtFeedback.ts` — envelope vs HUD alpha
- `src/net/RemotePlayerView.ts` — stop calling setArmor
- `src/core/Game.ts` — own food progress / hurtSeq; modelIntensity; no setArmor
- Tests: `player-visual-animation`, `remote-action-presentation`, `fire-overlay-hurt`
- Docs: PROJECT_STATE, ROADMAP, ARCHITECTURE, TESTING

## Architecture decisions

- Do not invent a new armor renderer in this pass.
- Do not compensate crouch with ad-hoc X/Z only on sneak; the sibling-rig Z offset was wrong once `upperBody` became a parent.
- Eat animation is progress-driven, not a one-shot click.
- HUD flash stays dim; only the player *model* matches mob contrast.

## Tests

Recorded after the commit in this report’s Git section.

## Visual QA

Automated hierarchy: hip/feet XZ stable, no `player-armor:*` meshes, eat bobble clears at progress 0. Live two-client Anarchy crouch/eat/flash/air-swing remains owner QA (SwiftShader ~4 FPS here).

## Performance

Fewer meshes than the overlay pass (no inflated cuboids). Eat pose is a few number writes per visible player with a held item.

## Known issues

- Worn armor is invisible on the model until a later dedicated pass.
- Coalesced `hurtSeq` 0→2 still shows one flash (same as `swingSeq`).

## Deferred

- New armor visual (vanilla layer sheets if the pack ships them)
- Owner two-client visual acceptance

## Next work

Owner live QA both directions (A↔B): crouch over legs (stand/walk/attack/mine/held item), eat and drink start/stop/swap, bright PvP flash, air swing still on miss.

## Git

Branch `cursor/armor-crouch-swing-flash-3f93` (PR #64), follow-up on `4bed9ae`.
