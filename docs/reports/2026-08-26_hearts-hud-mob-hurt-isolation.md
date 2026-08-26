# Hearts HUD scale and per-entity mob hurt flash

## Goal

Two targeted fixes on accepted armor-HUD HEAD `d8bccf8`:

1. Make the 10 health hearts match the 10 armor icons in visual width.
2. Hurt-flash only the damaged mob, not every mob of the same type.

## Result

Implemented on `cursor/fluids-and-items-pass-935a`. Draft PR #6 stays draft. `main` was not merged. No force push.

## Root Cause — Shared Hurt Flash

Per-entity `hurtFlashSeconds` and `userData.entityLight` were already unique.

The leak was the GPU tint path:

1. `VoxelVisualFactory` cached one `createEntityMaterial` per texture and attached that **same `THREE.MeshBasicMaterial` instance** to every zombie/spider/etc.
2. `createEntityMaterial` used an arrow-function `onBeforeCompile` that wrote `uEntityLight` onto the **closed-over template** (`material.userData`), not the compiling instance.
3. `bindEntityLightReceiver` copies root `entityLight` into `material.userData.uEntityLight` just before draw.

So every same-type mesh shared one uniform. Three.js also skips uniform re-upload when consecutive draws use the same material, so the last (or first) writer's red tint stuck on the whole species.

Previous report ("Tint: per-entity entityLight multiply. Shared materials не трогаются.") was true for `material.color` and the JS Vector3, false for the compiled uniform.

## Fix

Canonical mob renderer (`VoxelVisualFactory` + `createMobModel`):

- Templates stay in the factory cache (never attached to a live mesh).
- `beginEntityMaterials()` / `checkoutMaterial()` clones once per unique template **per entity** at spawn.
- `onBeforeCompile` uses `this` so each clone owns its `uEntityLight`.
- `disposeOwnedEntityMaterials()` on despawn/death. No clone per frame or per hit.

Still shared: geometry, textures/`map`, immutable template data, fire overlay material.

Per entity: `hurtFlashSeconds`, `entityLight` Vector3, owned material instance(s), `uEntityLight` uniform.

## Allocation / Cleanup

- Clone: once at `createMobModel` / `addBox` / `addTexturedCuboid`.
- Dispose: `MobManager.removeMob` before `removeFromParent`. Factory `dispose()` still only drops templates after `clear()`.

## Hearts HUD

| | Old | New |
| --- | --- | --- |
| Art | emoji `♥` via `pips()`, `letter-spacing: -2px` | 9×9 pixel-art `gui/heart_{empty,half,full}.png` |
| Size | font-size 14–20px, compressed | `--hud-status-icon-size: 0.92em`, `gap: 1px` (same as armor) |
| Count | 10 icons = 20 HP | unchanged 10 = 20 |
| Odd HP | `ceil(hp/2)` filled emoji | full/half/empty like armor (1 HP = one half heart) |

Armor HUD logic, icon count, and size were not changed. Health mechanics (`MAX_HEALTH = 20`) were not changed.

## Tests

Targeted: `tests/heart-hud.test.ts`, `tests/mob-hurt-flash.test.ts`, `tests/armor-hud.test.ts`, `tests/visual-models.test.ts`, `tests/entities.test.ts`.

Targeted: `tests/heart-hud.test.ts` (3), `tests/mob-hurt-flash.test.ts` (8), plus armor/visual-models/entities.

Full `npm run check`: typecheck PASS; vitest **60 files, 548 tests**; production **122 modules**, **1.17 MiB / 186 files** (three 9×9 heart sprites).

## Manual QA

A. HEARTS — 10 hearts same width as 10 armor icons; no overlap with hunger/hotbar.
B. SAME TYPE — two Zombies; hit one; only the target flashes red ~220 ms.
C. SPIDERS / OTHER — two of another type; hit one; only that one flashes.
D. REPEATED — several hits on one mob restart only its flash.
E. BURNING — burning mob hit: red flash then gone, fire overlay stays.

## Git

Branch `cursor/fluids-and-items-pass-935a`.
Implementation: `f8aea5b`.
Previous accepted HEAD: `d8bccf8`.
Working tree clean after ordinary push.
Draft PR #6. No merge of `main`. No force push.
