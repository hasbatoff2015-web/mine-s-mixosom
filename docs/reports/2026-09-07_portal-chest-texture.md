# 2026-09-07 — Portal Chest texture polish

## Goal

Make the Portal Chest body/lid texture closer to the chosen “portal accents” direction: dark teal/navy base, high-contrast pixel detail, purple/indigo accents. Do not change gameplay. Keep the existing gold/lime latch («нос») 1:1.

## Result

`entity/chest/portal.png` is still 128×128 with the same UV islands as the wooden chest. Latch 12×10 at (0,0) is byte-identical to the previous gold/lime clasp. Lid top has a concentric portal diamond, sides have teal ribbing, lower faces have clustered purple energy. Fallback `block/portal_chest.png` matches the new language. Ordinary `entity/chest/normal.png` is untouched.

## Implemented

- Regenerated portal entity atlas from 64×64 logical maps, nearest-scaled to 128, then blit of the previous latch.
- Dark navy/teal fill with grain; purple only as accents (corners, diamond ring, bottom energy), not a purple chest.
- Front keeps a dark teal latch recess; teal mid-tones around the lock; purple at lower corners only.
- 16×16 atlas fallback tile updated to the same palette (gold/lime drawn only on that 2D tile, not on the 3D latch mesh).

## Changed files

- `public/textures/entity/chest/portal.png`
- `public/textures/block/portal_chest.png`
- `scripts/paint-portal-chest.mjs`
- `tests/portal-chest-texture.test.mjs`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/reports/2026-09-07_portal-chest.md`

## Architecture decisions

- Asset-only. Chest model, UV, lid animation, `BlockId.PortalChest`, recipe, personal inventory, networking, and claims are unchanged.
- Latch is copied from the previous PNG rather than redrawn, so a future regen cannot silently recolour the «нос».

## Tests

```text
npx vitest run tests/portal-chest-texture.test.mjs tests/portal-chest.test.ts tests/chest-model.test.ts --maxWorkers=2
npm run typecheck && npm run typecheck:client && npm run typecheck:server && npm run typecheck:sim
npm run build
```

Texture pack asserts 128×128, latch hex, purple/teal on body/lid, and wooden `normal.png` latch is still not gold.

## Visual QA

Isolated item harness `?qaItem=portal_chest` (`qaView=back/front/left/right`) vs `?qaItem=chest`:

- Latch/front: existing gold/lime «нос» is unchanged; teal oval and dark recess around it; purple energy at lower corners.
- Back: teal ribs + clustered purple energy, no latch.
- Sides: vertical teal ribbing, purple along the bottom; lid top shows the concentric purple diamond.
- Ordinary wooden chest still oak/brown with a silver latch.

Typechecks (all four) PASS. Texture + chest-model tests PASS. `npm run build` PASS.

## Performance

No renderer or mesh changes.

## Known issues

Same as the original Portal Chest report: two-client inventory QA is still owner-side.

## Deferred

Pixel-perfect copy of the concept art. Vanilla Ender Chest eye latch (explicitly rejected).

## Next work

Owner in-world look at the new body around the unchanged latch.

## Git

Branch `cursor/portal-chest-3f93`, draft PR **#67**.
