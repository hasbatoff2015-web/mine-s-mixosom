# Goal

Surgical correctness pass after classic1.8 combat: control targeting, decoration support/drop, fluid displacement, embedded arrows, desktop input diagnostics/fallback, mob facing/gait and measured vertical knockback. No commit/push; user reviews gameplay first. No imported Minecraft code/assets.

# Git baseline

`feat/playable-voxel-alpha`, clean before edits. After fetch: HEAD = origin/main = `3b9e68ef6b4d982a2261e8332a7456685b6d84f7` (`feat: migrate melee to classic 1.8 combat`). No reset/clean/stash/rebase/config change. Baseline typecheck PASS; targeted15files207/207,12.69s. Full70files:692/714,22 failures,1RPC timeout,202.47s. Baseline failure classes are listed under Tests.

# Result

Runtime changes and regression coverage implemented. Partial browser QA actually performed in a new opt-in test world. Problem-PC native input and full combat/mobile/GPU acceptance remain open, not claimed PASS. Vertical reference matched, so no arbitrary Y reduction was introduced.

# User-visible bugs

Controls had different DDA/render geometry and render-only redstone state. Attachments never revalidated after support edits. Fluid entry reused ordinary placement replaceability. Both projectile owners treated inGround as permanent until timeout. Pointer requests lacked raw fallback/diagnostics, while unexplained focused unlock was guessed Escape. Mob body/gait followed total physical velocity, including recoil.

# Button/Lever targeting root cause

Two independent sources: duplicated control local AABBs versus oriented selection/mesh cuboids; Game's render provider merged redstone attachment/facing/power, but world DDA read only World.blockStates. Thus even a corrected box could use a different orientation from the visible control.

# Raycast vs selection geometry before

`World.raycast → blockSelectionBoxes → selectionLocalBoxes` used separate buttonLocalBox/leverLocalBoxes dimensions. `selectionBoxesForBlock` used buttonSelectionBox/leverSelectionBoxes matrices; mesher independently reconstructed controls. Background support could win a ray visibly aimed at the control.

# Canonical interaction geometry after

Exported buttonSelectionBox/leverSelectionBoxes drive mesh and outline; controlLocalBoxes caches AABB envelopes of these same matrices for existing DDA. Button remains its small plate; Lever has base + tilted handle, not full cell. No arbitrary padding. Tilted handle AABB conservatively includes a little empty space around the oriented cuboid. Actual DDA tests cover centers, near edges, oblique rays, nearby miss-to-support, 4facings×3mounts×2powered×2controls. No second raycaster. Redstone publishes changed geometry fields to World on source creation/orientation/output/restore.

# Support-loss root cause

Placement checked sturdy support once. Canonical setBlock/applyBlockBatch did not notify dependent decorations after mining/replacement/explosion/falling/fluid edits.

# Support dependency model

Shape-keyed SUPPORT_RULES in placement.ts: Torch/RedstoneTorch floor/wall, Button/Lever oriented floor/wall/ceiling, Ladder wall, Wire/Plates/Rail floor. supportCellForBlock shares attachmentNormal and actual facing; isBlockStillSupported shares canAttachToFace collision rectangles. Top slab can support a floor decoration; bottom slab cannot. Door placement remains checked, but two-cell door/bed lifecycle and generic plants are not expanded into this decoration contract.

Every actual raw material write and non-fluid shape-state change enqueues dependent changed cell +6neighbors in Map-dedupe. Max256 candidates per processSupportIntegrity call; Game has world-tick and post-interaction passes. Batch dedupes. Unknown unloaded supporting chunk retains ticket without generation. No whole-world scan. Deferred checks allow placement to assign orientation before validation.

# Detach/drop propagation

Invalid decoration → deferred batch Air through canonical mutation; old block state removed, mesh/light invalidated. World queues DetachedBlockEvent; Game drains once, notifies redstone and calls existing spawnDroppedStack/DroppedItemManager. Environmental drops also exist in Creative; direct Creative mining behavior is unchanged. No direct inventory grant. Repeated support/fluid/redstone checks cannot duplicate an event after removal. Lava replacement cleans state without loot. Existing item caps/merge/despawn/lava behavior remain authoritative.

Real ExplosionQueue test destroys only central Stone (radius0.7), leaving adjacent Torch/Button/Lever outside blast. Neighbor integrity then removes all3, creates3 drops, clears propagated light and redstone sources, releases a player arrow stuck in that Stone. Repeat drain creates nothing. This is not a special explosion decoration scan.

# Redstone cleanup

Game calls notifyBlocksChanged for detached/displaced events. Source entries disappear and network recomputation uses existing queues. Source geometry snapshots go to world state, but power/timer authority remains the existing redstone map. Tests include source restore, wall lever targeting, button pulse return and source deletion. No new redstone simulation or dynamic-light architecture.

# Water/Torch root cause

Torch was non-solid but not ordinary replaceable; canReplaceWithFluid therefore rejected it. Setting Torch.replaceable=true would also change block placement/anchor rules, so that shortcut was not used.

# Fluid-displaceable semantics

New optional BlockDefinition.fluidDisplaceable: Torch, RedstoneTorch, Lever, StoneButton, RedstoneWire, Rail. Prior replaceable plants continue to permit entry. Ladder/door/chest/fence/slab/stair/solid blocks and both pressure plates remain barriers. All six new flags leave replaceable unchanged.

Reference audit: [BlockDynamicLiquid1.8.9](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/block/BlockDynamicLiquid.java), third-party MCP mirror, reviewed as semantics only. Water displacement produces the old block's drop; Lava does not; material-blocking plates and explicit Ladder/Door barriers are retained. No source code copied.

# Water QA

Automated narrow channel: flowing water arrives at tick5 (never earlier), replaces every flagged decoration in floor/wall fixture, level7/non-falling, one drop after another15ticks, no inherited attachment/powered state. Separate actual propagated-light assertion: Torch neighbor blockLight>0 before,0 after Water replacement/flush.

Browser: new Creative `Polish QA 2026-08-27`, seed `interaction-support-polish`. Explicit dev fixture initially had an open alternate route; this was a fixture mistake, corrected by channel walls without fluid algorithm changes. Final screenshot/UI shows both floor/wall Torch cells Water, no torch meshes, dropped item visible. Later entity count1 alone is not proof of two separate entities because drops merge; exactly-once per cell is established by component assertions. Night ghost-light behavior is covered by real light-array test, not claimed from daytime screenshot.

# Fluid regressions

No routing costs/choice order, water/lava delays, due-time handling, fluid budgets, bucket helper or light/stream schedulers were retuned. Only fluid-entry semantic and canonical replacement event/state cleanup changed. Existing routing/timing/bucket assertions retained. Streaming tests have the same pre-existing14816.6667ms vs8000 threshold failures; they are not fluid routing acceptance failures.

# Embedded Arrow root cause

Both owners zeroed velocity and left inGround arrows fixed until timeout without recording/revalidating their hit support.

# Player Arrow behavior

ArrowPhysics shared record stores voxel coordinates/ID, impact point0.001 inside hit face, pre-impact velocity. Each inGround tick checks current ID and the same selection shapes used for projectile hit. If absent/replaced/shape no longer contains impact, clear embedded state, restore each velocity component×random×0.2 and continue existing flight gravity/drag/collision. Zero residual motion still gets gravity. No new arrow item pickup. Reference: [EntityArrow1.8.9](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/entity/projectile/EntityArrow.java). Current visual geometry and max48 remain unchanged.

Browser: five actual PlayerArrowManager shots into a log; before screenshot shows embedded shafts; after removing log, all five are visibly descending/reoriented, count5, not simply despawned. Tests cover unchanged pose/quaternion, Air/Water release, door shape change, unrelated edit and visual identity.

# Skeleton Arrow behavior

Existing MobManager projectile path uses the same support record/release helper; cap40 and geometry unchanged. Identical component tests pass for skeleton-owned arrows. Actual skeleton-fired browser scenario is still pending; player screenshots are not claimed as skeleton QA.

# Pointer-lock investigation

Kept existing InputManager/Game/UI lifecycle. [MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) and [requestPointerLock](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock) reviewed: Promise and older void APIs differ, unsupported raw input can use a plain request, pointerlockerror itself carries no detailed error reason.

# Problem-PC diagnostics

DEV `?inputDebug=1` renders locked flag, lock-change/error counts, reason, document focus/visibility, events/sec, last and largest16 dx/dy, accepted magnitude average/median, discarded invalid/spikes, raw/fallback flags. HUD updates4Hz, no mouse-event console spam; reset history on lock session transitions. Capture HUD when the issue happens on the real affected PC; that device's DPI/OS/browser behavior has not been observed here.

Browser automation clicks produced pointerlockerror (errors1 then2 after another explicit Continue), locked=false, changes0, rawRequested=true, fallbackUsed=false and no movement samples. This proves request rejection in this session, **not** a diagnosis of the user's intermittent mouse fault. No automatic request loop occurred.

# Raw movement request/fallback

One gesture-owned attempt requests `{unadjustedMovement:true}`. Only NotSupportedError/legacy options TypeError enables one plain request. Permission/security denial does not retry. Promise rejection supplies error detail; the accompanying event is not a second attempt. Older void success is accepted via lock change. Finished/generation guards and canCapture/focus check suppress stale fallback after modal/blur. Late lock acquisition while a modal is open is released. No stealing focus while inventory/chat/pause is active.

# Spike protection

Finite ordinary dx/dy pass exactly, no low-pass filter or normal clamp. Fixed16 accepted magnitudes; after at least4samples, an event must exceed both800 and12×recent mean to be quarantined. The next comparable magnitude (0.5..2×) restores the exact sum for sustained high-DPI turns; otherwise isolated candidate discarded. Non-finite/hypot-overflow rejected. Pending extreme sample can introduce one-event latency; genuine isolated extreme motion may be rejected. Fresh-session initial motion is deliberately not discarded, therefore an initial anomaly without baseline is not guaranteed caught. This conservative heuristic is not a claim that all hardware anomalies are solved.

# Lock-loss classification

Programmatic release → programmatic; hidden/unfocused → focus-lost; observed Escape → escape; unexplained focused loss → unknown, never guessed Escape. Escape opens existing pause without duplicate exit; unknown/focus-lost use existing click-to-resume fallback without retry. If browser suppresses Escape keydown, a native Escape unlock may be unknown and require another Escape/click. Native acceptance of this distinction, inventory/chat and fast mouse remains required.

# Mob facing root cause

Post-physics facingYaw and walkPhase were derived from velocity.xz. The same vector contains external knockback, so a hurt mob turned180° and played forward gait while being pushed backward.

# AI intent vs physics velocity

steerToward owns intended facing/speed; detected hostile target owns attack look. Skeleton retreat uses reversed translation without reversing target-facing. Existing meleeKnockback suppresses locomotion AI while airborne. Physics never writes facing from recoil. Passive flee can deliberately turn after recoil. previousFacingYaw, interpolation and snap contracts remain unchanged.

# Walk animation

Transient locomotionSpeed resets each fixed update and full hurt, set only by self-propelled AI. walkPhase/limb amplitude (including spider) use it, not physical velocity. Pure recoil gives static legs without a new hurt-animation system. Existing geometry/material caches retained.

# Vertical knockback measurement

Flat fixture, feet startY1, standing zombie, attacker(-1,1,0), random deterministic, no AI target. Log first20 fixed ticks after normal/sprint hit: positionY, velocityY(b/s), onGround, meleeKnockback, collision hitY and stepped. No magic tuning before measurement.

# Reference trajectory

From [EntityLivingBase1.8.9](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/entity/EntityLivingBase.java): move first; then gravity0.08blocks/tick², Y drag0.98, floor contact clears Y. Converted to b/s: y+=vy/20, vy=(vy-1.6)*0.98. Initial normal8; sprint10. Independent recurrence in regression matches each position within floor epsilon.

| Profile | First dy | Reference / Frontier apex | Apex tick | Ground tick/time |
| --- | ---: | ---: | ---: | --- |
| Normal | 0.4 | 1.153108 / 1.153108 | 5 | 11 /0.55s |
| Sprint | 0.5 | 1.708834 / 1.708834 | 6 | 14 /0.70s |

# Frontier trajectory

Normal (Y absolute, floor epsilon0.00001):

| Tick | Y | Vy | onGround | meleeKB | hitY | stepped |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1.400000 | 6.272000 | false | true | false | false |
| 2 | 1.713600 | 4.578560 | false | true | false | false |
| 3 | 1.942528 | 2.918989 | false | true | false | false |
| 4 | 2.088477 | 1.292609 | false | true | false | false |
| 5 | 2.153108 | -0.301243 | false | true | false | false |
| 6 | 2.138046 | -1.863218 | false | true | false | false |
| 7 | 2.044885 | -3.393954 | false | true | false | false |
| 8 | 1.875187 | -4.894075 | false | true | false | false |
| 9 | 1.630483 | -6.364193 | false | true | false | false |
| 10 | 1.312274 | -7.804909 | false | true | false | false |
| 11 | 1.000010 | 0 | true | false | true | false |
| 12 | 1.000010 | 0 | true | false | true | false |
| 13 | 1.000010 | 0 | true | false | true | false |
| 14 | 1.000010 | 0 | true | false | true | false |
| 15 | 1.000010 | 0 | true | false | true | false |
| 16 | 1.000010 | 0 | true | false | true | false |
| 17 | 1.000010 | 0 | true | false | true | false |
| 18 | 1.000010 | 0 | true | false | true | false |
| 19 | 1.000010 | 0 | true | false | true | false |
| 20 | 1.000010 | 0 | true | false | true | false |

Sprint:

| Tick | Y | Vy | onGround | meleeKB | hitY | stepped |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1.500000 | 8.232000 | false | true | false | false |
| 2 | 1.911600 | 6.499360 | false | true | false | false |
| 3 | 2.236568 | 4.801373 | false | true | false | false |
| 4 | 2.476637 | 3.137345 | false | true | false | false |
| 5 | 2.633504 | 1.506598 | false | true | false | false |
| 6 | 2.708834 | -0.091534 | false | true | false | false |
| 7 | 2.704257 | -1.657703 | false | true | false | false |
| 8 | 2.621372 | -3.192549 | false | true | false | false |
| 9 | 2.461745 | -4.696698 | false | true | false | false |
| 10 | 2.226910 | -6.170764 | false | true | false | false |
| 11 | 1.918371 | -7.615349 | false | true | false | false |
| 12 | 1.537604 | -9.031042 | false | true | false | false |
| 13 | 1.086052 | -10.418421 | false | true | false | false |
| 14 | 1.000010 | 0 | true | false | true | false |
| 15 | 1.000010 | 0 | true | false | true | false |
| 16 | 1.000010 | 0 | true | false | true | false |
| 17 | 1.000010 | 0 | true | false | true | false |
| 18 | 1.000010 | 0 | true | false | true | false |
| 19 | 1.000010 | 0 | true | false | true | false |
| 20 | 1.000010 | 0 | true | false | true | false |

Browser sample50ms at arena feet72 recorded peak1.153 normal,1.709 sprint, matching harness. Screenshots during both show yaw1.571 retained and static legs rather than recoil-facing flip. This does not prove subjective feel on the user's device.

# Any deliberate adaptation

None in this pass. Y profile, XZ halving/impulse/drag, hurt gate, sprint latch, W-tap, damage/crit/armor/sword block unchanged. Reference already lifts feet over one block; no Frontier-specific extra height or flat step-pop found. If user still wants a lower lift, that is an explicit subsequent product choice, not an integration bug fixed by secretly changing8/10. Existing horizontal20-tick displacement remains2.049883 normal,5.024349 sprint; wall0.69999.

# Tests

Final affected targeted: **330/330,21files,26.04s**, command `npm test --` with block-selection-raycast, lighting-torch-selection, placement-support, interaction-support-polish, redstone, fluids, fluid-routing, fluid-timing, fluid-surface, bucket-interaction, arrow-physics, arrow-visual-cleanup, embedded-arrow-support, fire-arrow-and-fire, combat, classic-combat-integration, mob-hurt-flash, mob-polish, pointer-lock, pointer-motion-polish, gameplay-modal (`tests/<name>.test.ts --maxWorkers=2`). Includes all new82 tests and unchanged classic/fluid/placement expectations. Water arrivals5/10/15/20, Lava30/60/90 preserved. CPU combat soak24mobs/300ticks/7200attempts: p95=1.780ms, max30.729ms, stable resource identities (not GPU).

Final full `npm test -- --maxWorkers=2`: **771/796,25failures,2RPC errors,74files (6failed/68passed),242.24s**. Same5 numeric failures and same6 failing files as baseline, but fire-contact timeouts17 vs14. Thus the strict no-worse-than-baseline condition is **not established**, not mislabeled PASS. No new correctness assertion failure. Further paired timeout diagnostics below distinguish current environment from a change-induced regression.

Baseline22 failures: fluid-streaming3 and lighting-scheduler1 (14816.6667ms expected<8000); held-item-vanilla-transform1 (unchanged GeneratedItemGeometry CRLF fingerprint e71967bd vs be428190); worldgen-terrain2 timeout; lighting-jobs lava-settle1 timeout; fire-contact-sunlight-minecart14 timeout. One worker RPC timeout. No unrelated threshold/assertion relaxed.

Preliminary full run during browser/source activity:767/794,27failures,1RPC,291.65s. Extra timeout cases included hostile-spawn cave1,20seed lava1 and fire-contact counts. Separate one-worker hostile-spawn8/8 passed; lava20seed still exceeded30s. This preliminary run is **not** claimed no-worse-than-baseline. Final full is run with the gameplay tab navigated away to remove its simulation/render load.

New82 tests across4files. Earlier broad targeted286/286 preceded redstone source-sync and two integrated light/explosion tests; final targeted supersedes it. Geometry expectations and classic/fluid tests remain intact.

Paired follow-up for the3 extra full-run timeouts: exact unchanged tests selected with `-t 'keeps a mob Fire Arrow burn|follows a curve and an ascending rail|places the player beside the cart' --maxWorkers=2`. Baseline HEAD extracted using git archive into a unique OS temporary directory, same installed dependencies via junction; workspace files/index untouched. Initial sandbox config-loading denial required approved execution outside sandbox for the temporary copy. Baseline **3/3 PASS**, timings3711/4836/4776ms; current **3/3 PASS**,3661/4808/4536ms. No5s threshold changes. These cases are very close to timeout under full parallel load; paired run found no slowdown/correctness failure. This is evidence of load-sensitive tests, not a replacement for the red full-suite result. Temporary baseline snapshot is outside the repository and was retained for reproducibility.

Production validation: `npm run typecheck`, `npm run build`, `npm run check:size`, `npm run check:archive` all **PASS**. Vite128modules; build6.15s; JS966.07kB (gzip270.83), CSS38.69kB (gzip8.98); unpacked **3.45MiB/186files**, root index.html and archive paths valid. Expected classic `/sdk.js` non-module and >500kB chunk warnings remain; SDK path unchanged. QA fixture strings absent from production bundle. No source/archive packaging changes.

# Browser QA

Actually performed in in-app browser at localhost4173, new world only. UI scenario buttons call real Game/World/managers; no hidden state injection/CDP/second physics. Screenshots inspected during this session:

| Scenario | Result | Qualification |
| --- | --- | --- |
| Floor lever / wall button | Target IDs correct, narrow outlines, Game use toggles/pulses | DEV aim/use buttons, not native RMB |
| Remove control supports | Air,2 dropped entities, source state gone | Real mutation + support queue |
| Water floor + wall torches | Both cells Water; torch meshes gone, item visible | Corrected bounded fixture; light tested on real CPU light arrays |
| Five player arrows / remove log | Five embedded then visibly falling | Same managers/visuals, not despawn substitute |
| Zombie normal/sprint | Stable recoil yaw, static gait, sampled peaks1.153/1.709 | Not native W-tap/critical/wall acceptance |
| Native pointer lock | Request rejected, diagnostics and no retry loop observed | Problem-PC issue not reproduced |
| Skeleton arrow / full mount matrix / crit-wall / mobile/GPU soak | Pending browser | Component tests only where listed |

# Performance

Support:7 local reads per material/shape mutation, dependent cells only queued, bounded256 checks/pass; overflow retained. No generation or chunk scan. Control AABB cache keyed by finite valid states; no geometry rebuild per mouse event. Embedded validation O(in-ground arrows) under existing48/40 caps. Mouse tiny16 history, O(1) acceptance, median only on4Hz DEV HUD; no console spam. Mob locomotion adds scalar intent, no new per-mob allocation. DEV fixture timer50ms only opted-in world; disposed with session and absent from production.

No worker/greedy/lighting/streaming redesign. Full-suite CPU time is environment-sensitive and not a GPU benchmark. Existing combat CPU identity soak remains in targeted regression; real10–15min frame/tick p95/GPU soak not performed.

# Files changed

- blocks/types.ts, registry.ts: independent fluid-displaceable flag/6definitions.
- world/placement.ts, World.ts, fluids.ts: shared support contract, local queue/event/state cleanup and fluid-entry predicate.
- rendering/specialBlockGeometry.ts, ChunkMesher.ts: canonical control cuboids/envelopes and shared mesh geometry.
- redstone/RedstoneSystem.ts: changed source geometry snapshot publication to World.
- combat/ArrowPhysics.ts, PlayerArrowManager.ts; entities/MobManager.ts: shared embedded support record/release; AI-facing/gait scalar.
- input/pointerLock.ts, pointerMotion.ts, InputManager.ts: single-attempt raw fallback, bounded sanitizer and opt-in diagnostics.
- core/Game.ts: event drain/redstone/drop orchestration, input lifecycle fallback, opt-in dev fixture lifecycle.
- dev/GameplayPolishQa.ts: explicit browser QA UI limited to seed/DEV flag.
- tests/interaction-support-polish.test.ts, embedded-arrow-support.test.ts, pointer-motion-polish.test.ts, mob-polish.test.ts: new regression coverage; arrow-visual-cleanup.test.ts and pointer-lock.test.ts: corrected fixtures/contracts.
- docs/PROJECT_STATE.md, ARCHITECTURE.md, TESTING.md, ROADMAP.md, MINECRAFT_1_8_COMBAT_REFERENCE.md and this report: current handoff/contracts/measurements. Historical reports unchanged.

# Architecture decisions

Extend canonical DDA/world/drop/arrow/input/mob paths. Keep World renderer-independent, support semantics data-driven, fluid displacement separate from placement, physics velocity separate from AI intent. Preserve fixed20TPS/live render-look and bounded existing optimizations. No new gameplay subsystem, authored assets or damage-profile rewrite.

# Implemented

The seven requested areas have implementations or measured evidence as detailed above; vertical constants were intentionally retained after the audit. New automated coverage82 cases; partial real browser observations are explicitly separated from pending native/device acceptance.

# Visual QA

See Browser QA for actually inspected screenshots and qualifications. No claim of problem-PC, skeleton browser, complete mount matrix or GPU soak acceptance.

# Known limitations

Not full acceptance: real affected-PC mouse, native Esc/modal behavior, skeleton browser arrows, all manual mount/control angles, critical/wall/W-tap and mobile/GPU soak remain pending. Lever uses conservative AABB envelope. Unknown unloaded supports wait for load; invalid legacy decorations without a new nearby mutation are not globally scanned. Door/bed/plant lifecycle not expanded. Pointer heuristic cannot diagnose all device/OS anomalies; raw support may vary. Vertical reference remains visibly above one block; no product lowering claimed. Full-suite baseline failures remain documented.

# Deferred

Unrelated CRLF fingerprint/scheduler/worldgen/lighting timeout investigation; broad combat/device acceptance; any user-selected vertical product adaptation. No new features (arrow pickup, multiplayer, advanced redstone etc.).

# Next work

User plays the modified game, captures inputDebug on the problem PC, and chooses whether reference-height recoil is acceptable. Complete outstanding native/browser matrix. Commit/push only after a separate explicit instruction.

# Git status

Intentional uncommitted modifications/new tests/docs only:21 tracked modified files +7 new files (report,2source helpers,4test files). HEAD and origin/main remain baseline3b9e68e; no commit/push performed. `git diff --check` PASS. Full runtime diff/new files reviewed: no damage/crit/hurt/armor/sprint-reset change, no fluid routing/timing/bucket rewrite, no ArrowVisualFactory/GeneratedItemGeometry/authored asset/package lock changes, no second raycaster/support engine. `git diff --stat` excludes the7 untracked files until a later authorized commit; do not omit them from the handoff.
