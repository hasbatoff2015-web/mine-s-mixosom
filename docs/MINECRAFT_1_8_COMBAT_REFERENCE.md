# Classic combat reference: Java 1.8.9

Проверено 2026-08-27. Этот документ заменяет combat-разделы 1.9 reference для текущего Frontier Cubes. Это reference чисел/порядка операций, не порт Minecraft и не обещание multiplayer parity. Код/брендированные assets не копировались. Остальные системы сохраняют свои текущие контракты.

## Источники

Просмотрены version-specific MCP 1.8.9 исходники (third-party mirror декомпилированного reference, не официальный Mojang API):

- [EntityPlayer](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/entity/player/EntityPlayer.java): `applyEntityAttributes`, `attackTargetEntityWithCurrentItem`, `damageEntity`; crit, sprint extra, slowdown, block, exhaustion.
- [EntityLivingBase](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/entity/EntityLivingBase.java): `attackEntityFrom`, `knockBack`, `applyArmorCalculations`, `moveEntityWithHeading`; immunity и движение.
- [ItemSword](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/ItemSword.java), [ItemTool](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/ItemTool.java), [ItemAxe](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/ItemAxe.java), [ItemPickaxe](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/ItemPickaxe.java), [ItemSpade](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/ItemSpade.java), [Item.ToolMaterial](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/Item.java): modifiers, durability, use action.
- [DamageSource](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/util/DamageSource.java): blockability/bypass.
- [EntityPlayerSP](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/client/entity/EntityPlayerSP.java): held-use input and sprint.
- [ItemBow](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/item/ItemBow.java), [EntityArrow](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/entity/projectile/EntityArrow.java): draw curve/launch path.
- [InventoryPlayer](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/entity/player/InventoryPlayer.java): armor points and armor wear (wear remains deferred).

## Damage: totals, not modifiers

EntityPlayer base attribute is 1. The item modifiers are added once; Frontier registry stores the resulting **total** and CombatSystem must not add another 1.

| Weapon | Wood | Stone | Iron | Diamond |
| --- | ---: | ---: | ---: | ---: |
| Sword | 5 | 6 | 7 | 8 |
| Axe | 4 | 5 | 6 | 7 |
| Pickaxe | 3 | 4 | 5 | 6 |
| Shovel | 2 | 3 | 4 | 5 |

Fist/other ordinary item: 1. Gold weapons/tools absent in current registry; not introduced by this task. Bow remains a ranged weapon, melee fallback 1.

Every click is a full-damage attempt. InputManager accumulates edges between 20-TPS ticks; no attackSpeed/charge/cooldown state or indicator. Target immunity, not a CPS limiter, determines actual damage. No sweep.

## Target immunity and damage pipeline

`HurtResistance` owns `remainingTicks`, `lastRawDamage` for each living target. Full accepted hit starts 20 ticks. While remaining >10, raw ≤last is rejected; stronger raw applies only the difference, updates last, without timer reset/full hurt/base KB. At ≤10 the next hit is full again. Melee and arrows share this state.

Player pipeline: raw comparison → optional sword block → fixed armor → absorption → HP/death. Armor multiplier `(25-clamp(points,0,20))/25`; toughness is ignored. `accepted` and `fullHurt` are distinct from positive HP damage. Absorption-only full hit still receives full hurt/KB. Differential hit does not repeat full feedback.

## Crit, sprint and knockback

Crit: falling (`fallDistance>0`), not grounded/water/ladder/blind/riding, living target; multiplier 1.5. Sprint does **not** forbid crit. No cooldown threshold. Frontier has no blindness feature; the helper accepts the condition, runtime has no status to supply.

Canonical units: player/mob velocity blocks/s, fixed tick 0.05s. Base transform halves XYZ, adds normalized away-from-attacker ×8 to XZ, sets Y=min(Y/2+8,8), grounded or airborne. The 8 is `0.4×20`, converted once.

Accepted sprint attack adds a separate facing-vector XZ ×10 and Y+2 (`0.5×20`, `0.1×20`). Extra level scales horizontal only. Frontier yaw0 faces −Z, so its signs are converted at the helper boundary. Then attacker XZ ×0.6, sprint=false. No slowdown on ordinary or rejected hits. A stronger differential hit may accept extra KB without second base KB.

Reference living travel moves before gravity/drag: XZ air0.91, ordinary-ground0.6×0.91; gravity0.08 blocks/tick² =32 blocks/s²; Y drag0.98. Frontier applies this during melee recoil in existing player/mob collision paths. Mob AI must not overwrite recoil while airborne; player input adds steering instead of blending away the impulse. Liquid/ladder/flight remain existing behavior; terrain step-up and collisions are not bit-exact vanilla.

## Sword use and consumption

Selected sword + held use + active gameplay + alive → blocking. Blockable incoming damage becomes `(1+damage)/2` before armor, including differential raw. No facing cone, wind-up, shield durability, axe disable or offhand shield. Forward/strafe ×0.2 and sprint off. Release, switch, broken sword, death, pause or blocking UI clear it. First-person pose is a cached transform overlay, not a new model; idle defaults unchanged.

Accepted melee costs exhaustion0.3 in Survival; air/rejected hits cost none. Reference sword wear is1, tool wear2. **Task §55 explicitly requests sword/tool −1**: Frontier deliberately uses1 for both, only on accepted living-target hits, never Creative.

## Explicit adaptations and retained behavior

- Sprint re-entry latch requires forward or sprint release before another sprint bonus, as explicitly requested. The vanilla client can re-enter sprint while the sprint key stays held; this latch is a product choice, not a claim of bit-exact client behavior.
- Melee recoil preserves existing different player/mob collision resolvers and step heights; flat/wall trajectories are tested, arbitrary terrain parity is not claimed. Coincident attacker/target centers use deterministic +X instead of random perturbation. No RNG when resistance0.
- Fire contact/lava/cactus/explosion/melee/projectile are sword-blockable. Fire DOT/fall/drown/starve/suffocate/void are not. Explicit bypassArmor also bypasses sword block. Existing Frontier Fire DOT and generic armor mitigation remain unchanged, unlike some Java bypass flags, to preserve the task's environmental damage contract.
- Bow draw remains `(x²+2x)/3`, x=ticks/20, cap1, threshold0.1; launch3×power. Existing air/water drag, critical arrow randomness, fire arrows, impact impulses and geometry are not migrated.
- Mob death animation and loot, natural regeneration, potions, armor durability, environmental damage rates, all-hostile sunlight burning remain pre-existing alpha behavior.
- No save schema change. Blocking, immunity timers and sprint/recoil flags reset on restore. Old extra cooldown/shield combat fields are ignored; legacy shield stacks are removed by the existing narrowly scoped migration.
- Enchantments, Knockback attribute equipment, Protection, XP, sweep, fishing rods, multiplayer/network reconciliation and advanced PvP feedback are deferred; no new gameplay feature is implied by reference source availability.

## Verification

Follow-up audit: `tests/mob-polish.test.ts` records20 fixed ticks on a flat floor and compares the entire Y sequence with independent discrete move → gravity0.08 → drag0.98 → floor collision. Normal: initial8b/s, first displacement0.4, apex1.153108 at tick5, landing tick11 (0.55s). Sprint: initial10b/s, first0.5, apex1.708834 at tick6, landing14 (0.70s). Both match reference (floor epsilon0.00001); stepped=false throughout, no extra Frontier pop. No vertical product adaptation was applied. Horizontal20-tick travel remains normal2.049883 / sprint5.024349, wall contact0.69999 in the classic fixture.

AI intent, not velocity, now owns mob facing and walk animation; pure melee recoil leaves gait static. Embedded arrows resume residual motion component×random×0.2 after loss of impact support, following EntityArrow semantics; existing geometry, free-flight drag/gravity and damage remain unchanged.

See `TESTING.md` and `reports/2026-08-27_interaction-support-mouse-mob-polish.md` for current QA. Normal/sprint recoil was inspected in the browser via an explicit DEV fixture UI; native-input/full combat/mobile/GPU acceptance remains pending. The prior classic report's blocked browser result is historical, not a current assertion that no browser inspection occurred.
