# 2026-08-22 Special icon preview lighting

## Goal

Fix dark `special_preview` inventory icons on `cursor/minecraft-item-pipeline-rework-935a` HEAD `68d2df9` before merge. Stairs/slabs/button/plates had correct shape and auto-fit size but looked almost black. Do not change geometry, auto-fit, icon size, `FIRST_PERSON_SPRITE_POSE`, `GeneratedItemGeometry`, world/held rendering, or gameplay. No commit/push.

## Result

Implemented. Ordinary cube/generated icons unchanged.

## Root cause

Two stacked bake bugs in `ItemIconRenderer` + shared `ItemVisualFactory` materials:

1. **Linear RT → sRGB canvas (main “almost black”).** Bake writes a `WebGLRenderTarget` whose texture default is linear. Game `renderer.outputColorSpace = SRGBColorSpace` applies to the canvas framebuffer, not this RT. `readRenderTargetPixels` returned linear bytes; `putImageData` treated them as sRGB. Mid-albedo (oak ~0.5 sRGB) becomes ~0.21 linear and reads as near-black wood/stone/brick.

2. **Entity/world-light shader on MeshBasic preview.** Special held meshes use `createEntityMaterial()` + `bindEntityLightReceiver()`. `MeshBasicMaterial` ignores scene Ambient/Directional lights (those bake lights were a no-op). The entity shader still does `diffuseColor.rgb *= uEntityLight * vEntityWrap`. Identity light × wrap 0.76–1.0 only mildly darkens; the linear readback was the crush. Preview must not inherit that runtime path.

Tone mapping was restored to `NoToneMapping` during bake as a guard (game currently does not set ACES, but canvas encoding must stay sRGB).

## Implemented

Preview-only clone in `itemIconPreview.ts` / `ItemIconRenderer.ts`:

- Clone material; `fog=false`, `toneMapped=false`, empty `onBeforeCompile`, cache key `special-icon-preview-unlit-v1`.
- Clear mesh `onBeforeRender` (drops voxel-light copy).
- Clone geometry; write light GUI vertex colors: top 1, Z 0.9, X 0.84, bottom 0.78 (not terrain 0.5).
- RT `texture.colorSpace = SRGBColorSpace`; save/restore renderer `outputColorSpace` / `toneMapping`.
- Dispose clones only; factory-cached geometry/materials untouched.

## Changed files

- `src/rendering/itemIconPreview.ts` (new)
- `src/rendering/ItemIconRenderer.ts`
- `tests/icon-scroll-fixes.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`
- `docs/reports/2026-08-22_special-icon-preview-lighting.md`

Not changed: `GeneratedItemGeometry.ts`, `FIRST_PERSON_SPRITE_POSE`, special geometry builders, world/held lighting.

## Tests

`npm run check` green: typecheck, 208 tests / 26 files, Vite 81 modules, 0.96 MiB / 165 files.

`tests/icon-scroll-fixes.test.ts`: face-shade range; clone does not mutate source `onBeforeCompile` / entity cache key; preview is unlit + vertex colors; `onBeforeRender` hook stripped.

## Visual QA

Check Creative/survival/hotbar:

- oak / birch / spruce stairs
- cobblestone / brick / stone brick stairs
- all family slabs
- `stone_button`
- `oak_pressure_plate`, `stone_pressure_plate`

Expect source texture color with a light 3D cue, not crushed shadows. Cube/generated icons unchanged.

## Performance

Bake still once per special item id; extra clone/dispose only during that bake.

## Known issues / Deferred

- Live WebGL bake still required for 3D icons (unit tests do not rasterize).
- Chest/furnace/recipe book/creative flight/general perf still out of scope.

## Git

No commit / push (per task).
