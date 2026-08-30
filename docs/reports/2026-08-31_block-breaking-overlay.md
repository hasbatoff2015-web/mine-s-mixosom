# Block breaking overlay

Date: 2026-08-31  
Branch: `cursor/block-breaking-overlay-3f86`  
Base main SHA: `a056e6f5d4b7f2e206b697f0a774ece921cbbefa` (`origin/main` at start)

## Goal

Add a Minecraft-like staged crack overlay while mining, without rewriting mining gameplay, remeshing chunks, or merging parallel UI/server branches.

## Result

Local-player visual overlay is wired. `session.miningProgress` remains the only progress authority. Overlay hides on cancel, retarget, break, vanished block, modal/hotbar reset and non-PLAYING lifecycle. HUD mining bar is unchanged.

## Minecraft reference behavior

Java-style destroy overlay:

- separate translucent crack texture on the block surface;
- 10 stages `destroy_stage_0` … `destroy_stage_9`;
- progress `(0, 1)` maps with `min(9, floor(progress * 10))`;
- `progress <= 0` hidden; `progress >= 1` block already broken / overlay gone;
- cancel (LMB up) is an immediate reset, not a fade;
- retarget starts the new block at stage 0;
- Creative / hardness 0 still instant-break — no fake delay.

## 10-stage contract

| progress | overlay |
| --- | --- |
| `< 0`, `NaN`, `0` | hidden |
| `0.01` … `0.099` | stage 0 |
| `0.1` … `0.199` | stage 1 |
| … | … |
| `0.9` … `0.999` | stage 9 |
| `>= 1` | hidden (broken lifecycle) |

Helper: `breakingStage(progress)` in `src/rendering/BlockBreakingOverlay.ts`.

## Asset source status

Recursive search in this workspace found **no** `destroy_stage_*.png` files.

`docs/ASSET_AUDIT.md` still lists pack-local `minecraft/textures/blocks/destroy_stage_0.png` … `_9.png`. `/assets/` is gitignored and empty in this Cloud environment, so those reference files were not available here.

## Licensing note

Those pack files, if present on a developer machine, are treated as Mojang/Minecraft reference only:

- local visual QA is allowed;
- they must **not** be committed to the public production repo;
- they were **not** committed in this pass.

Production ships **original Frontier crack masks** (deterministic pixel-art fractures, not copies of vanilla destroy sheets) at:

```text
public/textures/gui/destroy/destroy_stage_0.png
…
public/textures/gui/destroy/destroy_stage_9.png
```

Regenerate with `npx vite-node scripts/generate-breaking-overlay.ts`. Runtime also keeps a procedural DataTexture fallback, so a missing PNG does not crash the build or overlay.

Before public release, replace the production pack with licensed original crack art if the current generated masks are not accepted.

## Architecture

```text
Game mining update (20 TPS)
  session.target / session.miningProgress
        ↓
Game.updateBreakingOverlay()   // render path, one call
        ↓
WorldRenderer.setBreakingProgress(hit, progress)
        ↓
BlockBreakingOverlay           // one local mesh
        ↓
destroy_stage_0..9
```

- Overlay is not break authority and never calls `world.setBlock`.
- Future online: client can keep showing local predicted progress while the server remains the destroy authority. API stays `setBreakingProgress(hit, progress)`; a later `breakerId` map can sit beside the single local mesh.
- Parallel **server** and **UI** branches were not merged.

## No-remesh invariant

Stage and target changes only swap `material.map` and/or a cached overlay `BufferGeometry`. `Chunk.dirty` is untouched. Tests assert `chunk.dirty === false` and unchanged `WorldRenderer.faceCount`.

## Geometry support

Required and implemented via existing selection boxes:

- cube
- slab
- stairs (neighbor-resolved shape)
- fence (including connection arms in the overlay key)
- door

Also reused automatically (same selection path): chest, furnace/crafting table (cubes), glass (cube), lantern/chain/rail/torch/button/lever/plants/fire.

UV: each overlay face is 0..1 of the crack texture, not atlas UVs.

World position is integer block coordinates on the overlay mesh, independent of chunk local origin (verified at `x=15` and `x=16`).

## Special shapes / instant-break policy

Plants, torch, fire, rail, chain, lantern, button, lever often have `hardness <= 0` or complete in the same tick. Overlay will accept any `(0, 1)` progress using the simplified selection AABB, but gameplay usually jumps to `>= 1` so staged cracks are not visible. No extra mesh pipeline was added for those.

## Material / render order

- `MeshBasicMaterial`, nearest, no mipmaps
- `transparent=true`, `depthTest=true`, `depthWrite=false`
- `polygonOffsetFactor=-1`, `polygonOffsetUnits=-2`
- `renderOrder=5` (opaque 0, cutout 1, glass 2, water 3, fire 4, **cracks 5**, selection 10)
- modest luminance tint from existing sky/block samples (`0.42 + 0.58 * lum`), not a lighting-system change and not additive glow

## Performance

- at most one local overlay
- geometry cached by shape key
- 10 textures created once (shared module cache)
- dispose on `WorldRenderer.dispose()`
- no per-tick geometry allocate when stage/shape stay the same

## Game.ts integration

`+17` lines: `updateBreakingOverlay()` plus one call from `render()`. Mining tick / `breakTarget` / tool formulas were not rewritten. This keeps conflict surface with the colleague server branch small.

## Tests

`tests/block-breaking-overlay.test.ts` + `tests/breaking-overlay-textures.test.mjs`:

- stage mapping including `-1`, `0`, `0.01`, `0.099`, `0.1`, `0.5`, `0.899`, `0.9`, `0.999`, `1`
- PNG contract 32×32 × 10 files
- UV 0..1 cube faces
- shape keys cube/slab/stairs/fence/door
- missing hit / vanished block hide
- target change resets visual stage
- same stage reuses material/map/geometry
- no remesh
- chunk border world coords
- dispose

Targeted run: `npx vitest run tests/block-breaking-overlay.test.ts tests/breaking-overlay-textures.test.mjs tests/mining.test.ts --maxWorkers=2` → **16/16 PASS**.

Full `npm test -- --maxWorkers=2`: **997 passed / 7 failed / 1004** plus 1 vitest-worker RPC timeout.

Baseline-class failures (not introduced by this overlay):

- 2× `authored-item-assets.test.mjs` ENOENT (`assets/minecraft/textures` missing in this Cloud checkout)
- 5× `fire-contact-sunlight-minecart.test.ts` default 5s timeouts under full-suite load (minecart W/S, derail, friction, recapture)

`npm run typecheck`: PASS  
`npm run build`: PASS (151 modules)  
`npm run check:size` / `check:archive`: PASS **3.61 MiB / 231 files** (previous lighting main ~3.60 MiB / 221 files; +10 crack PNGs)

Main JS: ~1017 kB / ~287 kB gzip.

## Git

- Start `origin/main`: `a056e6f5d4b7f2e206b697f0a774ece921cbbefa`
- Branch: `cursor/block-breaking-overlay-3f86`
- Implementation commits: `00ed8e2` (feature), `d434623` (PNG contract test + validation notes)
- Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/28
- DO NOT MERGE

## Validation

See Tests above. Native GPU/mobile checklist remains open; DEV harness is `/?qaBreaking=1`.

## Manual QA

DEV harness: `/?qaBreaking=1` — cube, slab, stairs, fence, door; keys `0–9`, `[` `]`, `C` auto-cycle. DEV-only import from `main.ts`.

### Desktop

1. Survival dirt, hand — stages 0..9 then break  
2. Stone, hand — slower stages  
3. Stone, pickaxe (wood/stone/iron/diamond) — faster stages, same mapping  
4. Change target mid-break — B starts at 0; return to A starts over if gameplay reset  
5. Release LMB — overlay gone immediately  
6. Break completes — overlay gone  
7. Slab  
8. Stairs  
9. Fence (including connected)  
10. Door  
11. Glass  
12. Chunk border `x=15/16`, `z=15/16`  
13. Dark cave — cracks still readable  
14. Daylight — cracks not glowing  
15. Yellow selection outline remains on top of cracks  
16. Rapid repeated mining — no ghost cracks  
17. Creative instant break — no fake delay; overlay may not appear  

### Mobile

18. Long-press / mining control uses the same `miningProgress`  
19. Stages visible on slow breaks  
20. No extra desktop-only pointer-lock listeners in the overlay  

Cloud browser harness (`http://localhost:4173/?qaBreaking=1`): cube/slab/stairs/fence/door loaded; cube stage 0 sparse vs stage 9 dense; overlay stayed on the selected surface; yellow selection outline remained readable on top. The outline is LineSegments (expected), not a missing cube texture. Native Survival mining (dirt/stone/tools, cancel, cave, mobile long-press) is still an open device checklist.

## Parallel server / UI work

- Did **not** merge colleague server-authoritative branches (`cursor/shared-*`, online session, persistence, chest sync, etc.).
- Did **not** continue the UI HUD branch.
- Did **not** continue the old lighting branch.
- Overlay must stay a client visual. Online destroy success must not be inferred from crack stage.
- Keep the HUD mining bar until the UI branch removes it after integration.
