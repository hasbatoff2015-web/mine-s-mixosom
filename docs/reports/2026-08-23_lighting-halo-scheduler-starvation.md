# Lighting halo / scheduler starvation

Date: 2026-08-23  
Branch: `cursor/performance-world-loading-mob-smoothing`  
Previous HEAD: `34d1ad72b31779faa47c4f51fba6feddf3b75dde` (`dev: measure player-visible chunk latency`)  
PR: #4 remains draft. **main was not merged.** **No force push.**

## Goal

Keep the current low p95/p99 frame pacing and 2 ms lighting slices, but stop nearby wanted chunks from staying non-visible for tens of seconds because the lighting scheduler froze on a blocked head.

This is a scheduler/dependency pass, not a lighting-quality pass. Horizontal sky spread stays gone. Render distance is not reduced.

## Local evidence (before this pass)

Inspector after previous performance passes (FPS ~150, small LIGHT maxSlice, mesh itself fast):

### Nearby front hole

FRONT CHUNK distance **2**:

| Fact | Value |
| --- | --- |
| requested / generated / lit | yes |
| lightContextReady | **no** |
| meshQueued | yes |
| meshed / visible | no |
| MESH rank | ~5 |
| blockedBy | neighbor not lit (**S halo**) |
| wantedSince | **~18.75 s** |
| readyWhileWanted | no |

The chunk existed and was lit. Mesh was not allowed because a cardinal halo neighbor was still unlit.

### Max render distance (render 6 / requested 7)

wantedNow **169** (13×13).

| Lane | Capture |
| --- | --- |
| LIGHT | pending **71**, ready **1**, blocked **70**, oldest **~161 s** |
| head | **BLOCKED**, **stopsOnBlockedHead yes** |
| MESH | pending ~51, ready 0, blocked ~51, oldest ~159 s |

This is not “CPU too slow”. One ready lighting job existed and the scheduler never reached it.

## Exact root cause

`LightEngine` allows **one block-light flood at a time** (`floodOwnerKey`). Inspector “70 blocked / 1 ready” is that mutex, **not** a cycle of “A waits for B’s lighting computation”.

Sky/block lighting of a generated chunk does **not** require neighbors to be lit. Neighbor lit is only mesh `lightContextReady` (cardinal neighbors inside generate radius).

`World.processLighting` used to:

```ts
if (floodOwner !== '' && floodOwner !== key && floodOwner !== 'region') {
  counters.blocked += 1;
  break; // stopped the whole queue
}
```

Creative flight: start a flood, yield; player moves; nearer unlit chunks sort first; they are “blocked” (not flood owner) → **`break`** → flood **never resumes** → jobs pile up → oldest ~160 s. A distance-2 FRONT chunk stays `lightContextReady: no` because its S halo neighbor never finishes lighting.

There is **no A↔B lighting cycle**. Lighting jobs have no neighbor-lit edges. The mesh-context wait graph is a DAG: unlit/missing nodes are leaves.

## Halo dependencies

70/71 “blocked” meant: one in-progress flood owner (the single READY job) and everyone else waiting on the mutex. The READY leaf was often far behind the sorted head, so the scheduler never processed it.

Mesh context can still wait: lit chunk A needs cardinal neighbor B lit before A may mesh. Lighting B does not wait for A. Completing the flood owner (or a near unlock neighbor) unwinds that chain.

## Scheduler fix

Production path: `streamingScheduler.ts` + `World.processLighting` (same functions the CPU streaming sim and tests call).

1. **Skip blocked heads.** `isLightJobBlockedByFlood` + `continue`, never `break` on a waiter. `takeReadyLightJobs` is the same skip rule the mesh lane already used.
2. **Resume the flood owner.** Unlit jobs sort flood owner first, then unlock-near, then ring.
3. **Do not drop waiters.** Blocked jobs stay pending until the mutex is free or they leave generate radius.
4. **Obsolete flood.** If the owner is pruned **or** outside generate radius, abandon the mutex and reset that chunk’s block-light cursor (sky fill kept). Pending obsolete lighting does not keep competing.
5. **Preempt distant flood.** If chebyshev > 2 and there is critical unlit work that unlocks a near wanted mesh, drop the distant mutex and start the unlock job. Reverse flight must not keep lighting the old east halo while the player looks west.
6. **Generation unlock.** `missingChunkCoords` sorts keys from `lightingUnlockNeighborKeys` first so a missing S halo that blocks a distance-2 mesh is generated before a far request-ring chunk.
7. **Bounded scan.** Only unlit chunks inside generate radius (≤ 15×15 at rd=6). No per-frame all-blocked graph. Completing a chunk is the wake-up: next slice re-sorts remaining unlit.

`WORLD_LIGHT_BUDGET_MS` stays **2**. No 2→20, no return of 30 ms monolithic sky.

## Dependency priority

Order inside the live generate radius:

1. In-progress flood owner (unless obsolete or preempted as distant-vs-critical).
2. Unlit chunks in `lightingUnlockNeighborKeys` (player chebyshev ≤ 2, plus unlit/missing cardinals of those wanted chunks).
3. Rest of visible mesh ring, then generate halo.

Inspector DEV-only: FRONT/PLAYER **DEPENDENCY CHAIN** (`A → S → unlit leaf READY to light`, or `CYCLE DETECTED` if a cycle ever appears). Valid lighting/mesh-context graphs do not cycle.

## Obsolete lighting

- Unlit chunks **outside generate radius** are not processed.
- Flood owner outside that radius or after `pruneChunks` → mutex cleared.
- Cached light arrays on still-loaded chunks are not wiped except incomplete block-seed cursor reset so a later visit can restart cleanly.

## High render distance

Render 6 / request 7 is a stress case (169 wanted + halo). It is not “fixed” by lowering distance.

CPU streaming sim (`runStreamingPath`, production `processLighting` + 2 ms slices, no GPU):

| Scenario | WANTED→VISIBLE p50 / p95 / max | READY-WANTED→MESH max | near (≤2) missing streak | player miss |
| --- | --- | --- | --- | --- |
| fly r4 sliced | 1.67 / 3.40 / 3.60 s | 0 | 3.83 s | 0 |
| fly r6 sliced (30 chunks) | 3.02 / 5.15 / 5.25 s | 0 | 4.73 s | 0 |
| reverse r6 | 2.92 / 8.77 / 11.60 s | 0 | 4.70 s | 67 ms |
| zigzag r6 | 4.42 / 8.53 / 10.83 s | 0 | 3.85 s | 0 |

Instant-light fair mesh (isolates mesh fairness): WANTED→VISIBLE p95/max **200 ms**, obsolete **0**.

READY-WANTED→MESH ~0 on sliced-light flights: once a wanted chunk is generated+lit+context-ready, mesh starts the same frame. Remaining WANTED→VISIBLE time is **lighting throughput** (one flood, 2 ms/slice, ~169-chunk window), not a stuck head.

Orders-of-magnitude vs local QA **18.75 s / 161 s blocked**. Typical/p95/max <250/500/1000 ms for *all* 169 wanted chunks at rd=6 with a 2 ms slice is not claimed; distant edges still stream. Player chunk miss stays ~0. Critical blocked age can no longer grow to 160 s because the ready owner is processed.

Peak LIGHT pending ~213 with ~212 flood-waiters is expected (mutex). Progress happens because the ready owner runs. `stopsOnBlockedHead` is **no**.

## Frame budget

`WORLD_LIGHT_BUDGET_MS = 2` unchanged. Lighting benchmark 9×9 sliced `maxSlice ≈ 5.3 ms` is yield/scan slop of `processLighting`, not a 30 ms sky job. Rapid-break bench: `pendingMesh: 1`. Mesh CPU samples still ~18–29 ms/chunk (unchanged architecture).

No adaptive extra light slice in this pass: the deadlock was logical; remaining rd=6 delay is serialized 2 ms lighting filling a large window. Raising 2→20 would hide that and risk frame pacing.

## Automated QA

Cursor reproduced the scheduler bug **without a browser GPU**:

- Unit: blocked head + ready second; 70 blocked + 1 ready (`takeReadyLightJobs`); production `processLighting` resumes a near flood owner; A→B→C mesh wait resolved by lighting the leaf; DAG / no lighting A↔B cycle; near unlock outranks distant halo; distant flood preempted; obsolete unlit skip; obsolete/pruned flood abandoned; radius 6 = 169 wanted; 2 ms slice; torch border; flat sky seam; rapid break; CPU fly near-hole bound `< 4 s` (not 20–160 s).
- `npm run benchmark:streaming` — walk / Creative fly / reverse / zigzag, instantLight and honest 2 ms light, r4 and r6.
- `npm run benchmark:lighting` — torch border, furnace, roof hole, 30-break mesh collapse.

WebGL/`?perf=1&chunks=1` Creative flight at max distance was **not** run in this cloud environment.

## Regression

Unchanged on purpose: mob interpolation, rapid-break dirty coalescing, simplified vertical sky, torch cross-border block light, mesh fairness vs generation, player-visible inspector clocks (PREFETCH AGE, WANTED AGE, READY-WANTED WAIT, WANTED→VISIBLE, LAST SLOW VISIBLE CHUNK, F9).

## Tests

See `docs/TESTING.md`. `npm run check`: typecheck PASS, **368 tests / 44 files** passed, production build 100 modules, 1.08 MiB / 167 files. New file `tests/lighting-scheduler.test.ts` (19 tests) uses production `processLighting` / `takeReadyLightJobs`.

## Manual GPU QA (still for the user)

Open `?perf=1&chunks=1`, Creative fly at max render distance, reverse, confirm:

- LIGHT `stopsOnBlockedHead no`, ready jobs processed, `oldestCritical` not tens of seconds beside the player;
- FRONT distance 1–2 not `wantedSince ~18 s` with S halo unlit;
- no return of square sky seams or 30 ms LIGHT slices;
- nearby holes fill in hundreds of ms to low seconds, not ~160 s.

## Git

Feature branch only. No merge to main. No force push.
