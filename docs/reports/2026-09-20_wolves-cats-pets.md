# Wolves and cats (pets)

## Goal

Add server-authoritative tameable wolves and cats on current `main`, without a parallel pet simulation, cases, ocelot gameplay, worldgen, minecarts, or unrelated combat changes.

## Starting main SHA

`717fee7357bc7326130cc07aa2ccd11220de55fa` after `git fetch origin --prune`, `git switch main`, `git pull --ff-only origin main`. Feature branch: `codex/wolves-cats-pets`. Unrelated untracked `assets/minecraft/textures/entity/chest/event_chest.png` was left untouched.

## Audit (before implementation)

1. **Passive spawn** — `MobManager.tryPassiveSpawn` sampled a column, required GrassBlock, then picked uniformly from `PASSIVE_KINDS` (cow/pig/chicken/sheep). No biome table.
2. **Caps** — `maxMobs=48`, `passiveCap=20`, `hostileCap=28`. `countByDisposition` counted every living mob of that disposition. `evictFarthestOrOldest` could pick any mob.
3. **Distance despawn** — `> 72` blocks for `> 8` s, plus `y < -32` safety. Applied to all mobs.
4. **Serialize/restore** — `SerializedMob` had id/kind/pose/health/state/age/fuse. Restore used `force` and stopped at `maxMobs`.
5. **EntitySnapshot** — kind, pose, velocity, mobKind, health, onFire, hurt, state, plus minecart/item fields. No owner/sit.
6. **Client visual** — `host.createMob(kind)` + `syncMob`; `LegacyModel` / `ThreeEntityHost`.
7. **RMB / interact** — block `block_use`, minecarts, buyers, holograms. Mob raycast was melee. No entity interact packet.
8. **Player actions** — sequenced `actionSeq`/`commandSeq`/`selectedSlot`; unknown kinds fell through to attack.
9. **Roles** — `PermissionService` + `DEFAULT_ROLES`; operators `has()` = true for every node. Limit must not use `has()`.
10. **petLimit** — resolve from granted `pets.limit.N` nodes only (highest valid N in 2..10), never store on mob or player save.

## Result

Wolves and cats are ordinary `MobKind` entries in `MobManager`. Natural spawn is biome-weighted. Taming / sit-stand uses sequenced `entity_use`. Pets persist, sync, follow, teleport cheaply, and respect `pets.limit.N`.

## Implemented

- `wolf` / `cat` definitions, empty loot, legacy models, original 128×64 PNG copied into `public/textures/entity/{wolf,cat}/`.
- Cat variants `black|red|siamese` chosen once at spawn; `ocelot.png` kept unused.
- Wolf appearance: wild / angry / tamed + red-tinted collar overlay on owned material clones (collar sheet is white+alpha; tint `0xB02E26`).
- Sitting pose via `legacyRotationToThree` each frame from base transforms (no accumulated offsets).
- `entity_use` PlayerAction; client picks closest pet vs block/minecart; server validates seq/slot/reach/LOS/ownership/limit.
- Follow, bounded teleport (24 XZ candidates, `getBlock(..., false)`), wild cat fear, tamed wolf combat through existing damage/PvP/claims.
- Default pet limit 2, roles `pet_plus` (`pets.limit.3`) and `pet_master` (`pets.limit.5`), hard max 10. Lowering the limit never deletes pets.
- Tamed pets skip wild `passiveCap`, distance despawn, and capacity eviction. Restore prefers tamed entries. Pets may overflow `maxMobs`; wild spawn then stops.

## Architecture decisions

Pets are ordinary mobs. `ownerId` is the tame flag. Limit is a player permission, never stored on the mob or player save. Teleport never generates chunks. Combat targets are assigned only after accepted server damage. Collar color is applied on owned clones, never on shared material templates. Cat standing `tail2` uses the same legacy `rx=0.9` as `tail1` (vanilla `setRotationAngles`).

## Model source / layout

Legacy ModelWolf / ModelOcelot pivots and boxes; `16 units = 1 block`; `legacyRotationToThree` after Y reflection. Logical texture 64×32, physical 128×64. Sitting coordinates from the task, converted through the same adapter.

### Wolf parts

head `(-1,13.5,-7)`, body `(0,14,2) rx=π/2`, mane `(-1,14,2) rx=π/2`, legs 1–4, tail `(-1,12,8)`.

### Cat parts

head `(0,15,-9)`, body `(0,12,-10) rx=π/2`, tail1 `(0,15,8) rx=0.9`, tail2 `(0,20,14) rx=0.9`, four legs.

Walk: wolf diagonal `[+,-,-,+]`; cat separate front/back; light tail wag. Sitting zeroes walk. **Walk is an alpha approximation.**

## Copied assets

Unmodified PNG from `assets/minecraft/textures/entity/{wolf,cat}/` into `public/textures/entity/...`. Physical **128×64**, logical **64×32**. Alpha present. Tests decode RGBA.

## Cat variants

Uniform `black` / `red` / `siamese` at spawn. Unchanged after tame. Ocelot is not a gameplay kind.

## Taming rules

- Wolf: `ItemId.Bone`.
- Cat: CookedBeef / CookedPorkchop / CookedChicken.
- Chance `1/3` server RNG (`random() < 1/3`).
- Survival consumes on a valid attempt, including fail.
- Creative does not consume.
- Limit reached does not consume.
- Success: `ownerId = player.id`, `sitting=true`, chat «Волк приручён.» / «Кот приручён.»
- Immediate X/Z stop. Already tamed: owner toggles sit/stand; others `not_owner`.

## entity_use protocol

`PlayerActionKind.entity_use` with `actionSeq`, `commandSeq`, `selectedSlot`, `targetId`, optional look. PROTOCOL_VERSION unchanged (additive snapshot fields). Server re-checks eye, 3-block reach, voxel LOS, slot, seq, kind, ownership, held item, pet limit.

## Follow / teleport

- Stop ≤ 4, steer 4–16, teleport > 16.
- Cooldown 0.75 s.
- 24 candidates, ring 2–4.
- `getBlock(..., false)` only — no worldgen.
- Failed teleport still allows steering toward the owner on later ticks after cooldown.
- Sitting: no follow / teleport / combat.
- Offline owner: cheap idle near last home, no despawn.

## Pet limit

- Default 2.
- `pets.limit.N` for integer N in `[2, 10]`. Highest valid N wins.
- Malformed / `pets.limit.1` / `pets.limit.999999` ignored.
- Operators are not unlimited.
- Count: living wolf/cat with `ownerId === player.id`.
- Role removed: extra pets remain; new tames blocked until `ownedCount < currentLimit`.

## Wolf combat

- Wild: angry at attacker, `wolf_angry`, ~20 s timeout. Attack 2, HP 8, cooldown 1 s.
- Tamed standing: assist owner hits (melee/projectile), defend owner after accepted hurt. PvP/claims via existing `playerDamage`.
- Sitting: no chase/attack/teleport.
- Cat: never combat.
- Uses `MobManager.damage` and canonical player hurt. Owner is never a combat target.
- Drop combat if farther than 18 from owner.

## Cap / despawn

Tamed excluded from `countByDisposition('passive')`, `updateDistanceDespawn` (except `y < -32`), and `evictFarthestOrOldest`. Wild interval/caps unchanged in purpose; wolf/cat compete for leftover wild slots.

### Spawn weights

| Biome | cow/pig/chicken/sheep | wolf | cat |
|---|---|---|---|
| plains | 12/12/10/10 | — | 2 |
| forest | 12/12/10/10 | 2 | 2 |
| snowy_plains | 10/10/8/8 | 2 | — |
| desert | 12/12/10/10 | — | — |

Wolf surface: GrassBlock or SnowBlock. Cat: GrassBlock only.

## Persistence

`SerializedMob` optional `ownerId`, `sitting`, `variant`, `angry`. Combat target / teleport cooldown / walk phase not saved. Old cow saves restore. Missing cat variant → `black`. Tamed restored before wild.

## Network snapshots

Optional `ownerId`, `sitting`, `variant`, `angry`. Client `applyPetNetworkState` updates appearance only when the key changes. Interpolation remains `EntityInterpolationBuffer` / `shouldSnapPose` (`ENTITY_SNAP_DISTANCE = 6`). Teleport 16 always snaps.

## Performance (20 pets, 40 ticks, this machine)

| scenario | avg ms | p95 ms | max ms | searches | candidateChecks |
|---|---|---|---|---|---|
| idle near owners | 1.06 | 7.51 | 7.71 | 0 | 0 |
| follow | 0.99 | 2.88 | 5.66 | 0 | 0 |
| teleport catch-up | 0.63 | 2.91 | 6.19 | 20 | 20 |

Teleport: one bounded search per pet on the first far tick, then cooldown. Candidate checks / search = 1 here because the first of 24 stone-floor candidates succeeds (cap 32). Follow is not the server-tick hotspot.

## Tests

- `tests/pets.test.ts` — tame, items, RNG, sit, limits, follow, teleport, despawn, caps, fear, combat, spawn, persist, roles.
- `tests/pets-performance.test.ts`
- `tests/pet-textures.test.mjs` — 128×64 + alpha, nested wolf/cat paths.
- `tests/server/pets-anarchy.test.ts` — two-player snapshot, owner-only sit, forged reach/LOS/slot/seq, limit no-consume.
- `tests/visual-models.test.ts` — pivots, parts, sit/stand no drift, glob `entity/**/*.png`.
- Regression: entities, entity-host, interpolation, snapshot interpolation, mob-polish, hurt flash, projectile routing, network visual events, death animation, initial lighting, anarchy-gameplay, permissions.

## Manual QA

DEV harness `?qaMob=` screenshots:

- Wolf wild front/side/rear/three-quarter: eyes, muzzle, ears, legs on ground, body yaw matches model +Z.
- Wolf sitting side: rear on ground, body raised, front legs near-vertical, rear folded, tail behind. Not floating/sinking.
- Wolf angry front: red eyes / angry brows (`wolf_angry`).
- Wolf tamed: `wolf_tame` sheet + red mane-collar overlay (white collar PNG × `0xB02E26` on owned clones).
- Cat black front/side: ears, pink nose, green eyes, white paws; tail1/tail2 connected after standing `rx=0.9`.
- Cat red three-quarter: orange tabby UVs.
- Cat siamese sitting three-quarter: cream body, dark points, blue eyes, sitting pose grounded.

Not performed in this environment: true two-client live browser Anarchy session, in-world natural spawn camping, full survival tame loop with inventory, role grant via `/permissions` in a running server.

## Git

Branch `codex/wolves-cats-pets`. Not merged to main.
