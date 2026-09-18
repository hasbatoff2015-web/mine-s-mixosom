# 2026-09-18 Merge Utility Items V1 into current main

## Goal

Integrate accepted `codex/utility-items-v1@475acc6` into `origin/main@ef619a9` on `merge/utility-items-v1` without shifting OakSign off 165 or dropping generic unknown-block compatibility.

## Result

Semantic `--no-ff --no-commit` merge resolved. OakSign stays **165** and is now a registered block. Unknown placeholders remain for other Uint16 IDs (`65534`). Feature history was not rewritten.

## Conflict files

- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md` — both histories kept, merge section prepended.
- `server/WorldInstance.ts` — union of menu/trade imports with book/sign types.
- `src/style.css` — main pause/graphite chrome plus Utility `#totem-flash`.

Auto-merged and then audited: `src/blocks/registry.ts`, `src/world/World.ts`, `src/world/LightEngine.ts`, `shared/protocol.ts`, `src/core/Game.ts`, `src/ui/GameUI.ts`.

## registry.ts

Kept main `UNKNOWN_BLOCK_MAX_ID = 0xffff`, `normalizeStorableBlockId`, runtime placeholders, `tryGetBlockDefinition` / `getBlockDefinition`. Added Utility registrations including `SugarCane = 164` and `OakSign = 165`.

## World.ts

Kept main restore: `normalizeStorableBlockId` + `adoptUnknownBlockLight`. Kept Utility `signs` / `sanitizeSignLines` / `signVersion`.

## ID 165

`BlockId.OakSign === 165`. Saves with numeric or string `"165"` restore as OakSign without rewriting the voxel. Generic unknown coverage moved to `65534`.

## Tests / gates

- 165/unknown serial: block-registry 17/17, unknown-block-load 4/4, fs-world-store 8/8.
- Utility + menu focused: 22 files / 219 PASS; `chat-layout` 4 CRLF host failures (selectors present).
- Typechecks, boundaries, build, size/archive PASS. Production **4.74 MiB / 403 files**.
- Full `npm test --maxWorkers=2`: **245/252 files, 2358/2381 tests**. Failures match host baseline / parallel timeouts: extractor parse, chat-layout CRLF, fire-contact-sunlight-minecart 5s, worldgen 5s, tick-load-flight >80ms, plus load flakes (`lighting-scheduler`, `import-schematic`) that PASS isolated. Not treated as merge regressions.

## Git

Merge commit on `merge/utility-items-v1`, then ff-only into `main`.
