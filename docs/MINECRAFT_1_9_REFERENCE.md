# Minecraft Java Edition 1.9: reference механик

Проверено: **2026-08-16**. Целевая историческая версия — **Java Edition 1.9 release от 2016-02-29**, а не расплывчатое «1.9+». Minecraft используется только как механический ориентир: код, название продукта и оригинальные ассеты не копируются.

## Как читать документ

- **1.9 — подтверждено**: значение относится к release 1.9 либо к snapshot, вошедшему в него.
- **Alpha target**: значение, принятое в этом проекте.
- **Approximation**: намеренное упрощение; это не утверждение о поведении Minecraft.
- Урон ниже указан в HP: `1 HP = половина сердца`, у игрока `20 HP`.
- Симуляция Minecraft и проекта работает с частотой `20 TPS`; один tick равен `0.05 s`.

Самые важные несовпадения уже сейчас: alpha использует sneak AABB `0.6 × 1.5` вместо 1.9-высоты `1.65`, sneak eye `1.27` вместо примерно `1.54`, terminal fall speed `50 b/s` вместо `78.4 b/s`, единый reach `5` вместо `4.5` для блоков и `3` для сущностей, а armor toughness относится к **1.9.1**, не к чистой 1.9. Combat cooldown уже учитывает vanilla-смещение `+0.5 tick`.

## Подтверждённые значения Java Edition 1.9

### Movement, collision и reach

| Параметр | Java 1.9 |
| --- | ---: |
| Обычная ходьба по ровной поверхности | около `4.317 blocks/s` |
| Sprint | около `5.612 blocks/s`, то есть `+30%` к movement-speed attribute |
| Sneak | около `1.295 blocks/s` |
| Sprint-jump, средняя скорость | около `7.127 blocks/s` |
| Step height | `0.6 block` |
| Standing AABB | `0.6 × 1.8 blocks` |
| Sneaking AABB именно в 1.9 | `0.6 × 1.65 blocks` |
| Eye height standing | `1.62 blocks` от ног |
| Eye height sneaking в старой реализации | примерно `1.54 blocks` (`1.62 - 0.08`) |
| Survival block reach | `4.5 blocks` |
| Survival entity/melee reach | `3.0 blocks` |

Значения `4.317`, `5.612` и `1.295` — установившиеся скорости на обычной поверхности. Vanilla достигает их через ускорение, momentum и трение, поэтому простая мгновенная установка горизонтальной скорости даёт похожий темп, но не полностью совпадающее ощущение разгона и остановки. Sprint не увеличивает высоту прыжка. Sneak также не позволяет сойти с края, если перепад под ногой не меньше `5/8` блока.

Исторически важно: sneak AABB стал `1.65` в snapshot 15w42a и оставался таким в release 1.9; высота `1.5` появилась намного позже, в 1.14. Источники: [Java Edition 1.9](https://minecraft.wiki/w/Java_Edition_1.9), [15w42a](https://minecraft.wiki/w/Java_Edition_15w42a), [Player](https://minecraft.wiki/w/Player), [Walking](https://minecraft.wiki/w/Walking), [Sprinting](https://minecraft.wiki/w/Sprinting), [Sneaking](https://minecraft.wiki/w/Sneaking), [Breaking — reach](https://minecraft.wiki/w/Breaking).

### Jump и gravity

- При прыжке вертикальная скорость задаётся как `0.42 block/tick`, то есть `8.4 blocks/s`.
- После перемещения каждый tick применяется:

  ```text
  vy(next) = (vy(current) - 0.08) × 0.98
  ```

- `0.08 block/tick²` — дискретная gravity-константа; `0.98` — vertical drag.
- Предельная скорость падения следует из формулы: около `-3.92 blocks/tick`, или `-78.4 blocks/s`.
- В 1.9 после изменения 15w45a высота обычного прыжка составляет примерно `1.2522 blocks`.

Источники: [Entity — motion/gravity](https://minecraft.wiki/w/Entity#Motion_of_entities), [Transportation — vertical speeds](https://minecraft.wiki/w/Transportation#Vertical_transportation), [Jumping](https://minecraft.wiki/w/Jumping), [15w45a](https://minecraft.wiki/w/Java_Edition_15w45a).

### Mining formula

Для каждого tick удержания добычи вычисляется прогресс. Пусть:

- `H` — hardness блока;
- `S` — итоговый speed multiplier инструмента с модификаторами;
- `canHarvest` — блок можно добыть текущим инструментом: для большинства блоков рука подходит, а `drop.requiresCorrectTool` (камень, руды, furnace) требует правильный тип и mining tier.

Правильный инструмент ускоряет добычу через `S`, даже если блок и так harvestable рукой. `/100` применяется только когда `canHarvest` ложен.

Тогда:

```text
progressPerTick = (S / H) / 30    if canHarvest
progressPerTick = (S / H) / 100   otherwise
breakTicks       = ceil(1 / progressPerTick)
```

Прогресс суммируется до `1`. Неправильный инструмент не только работает медленнее: для блока с обязательным инструментом он не даёт нормальный drop. Базовый `S = 1`; speed правильных инструментов:

| Tier | Mining level | Speed | Durability | Примечание для 1.9 |
| --- | ---: | ---: | ---: | --- |
| Hand / no tool | — | `1` | — | Нет tier-добычи |
| Wood | `0` | `2` | `59` | Камень и coal доступны |
| Stone | `1` | `4` | `131` | Iron ore доступна |
| Iron | `2` | `6` | `250` | Gold, redstone и diamond доступны |
| Diamond | `3` | `8` | `1561` | Obsidian доступен |
| Gold | `0` | `12` | `32` | Очень быстро, но mining level остаётся `0` |

Дополнительные vanilla-модификаторы:

```text
Efficiency N, только для подходящего инструмента: S += N² + 1
Haste level L:                              S *= 1 + 0.2 × L
Mining Fatigue level L:                     S *= 0.3^min(L, 4)
Голова в воде без Aqua Affinity:            S /= 5
Игрок не стоит на земле:                    S /= 5
```

Основные hardness-значения, используемые в scope alpha:

| Блок | Hardness | Правильный инструмент | Минимальный tier для drop |
| --- | ---: | --- | --- |
| Grass block | `0.6` | Shovel | Hand |
| Dirt / Sand | `0.5` | Shovel | Hand |
| Gravel | `0.6` | Shovel | Hand |
| Stone | `1.5` | Pickaxe | Wood |
| Cobblestone | `2.0` | Pickaxe | Wood |
| Sandstone | `0.8` | Pickaxe | Wood |
| Log / Planks | `2.0` | Axe | Hand |
| Leaves | `0.2` | Shears | Hand |
| Wool | `0.8` | Shears | Hand |
| Glass | `0.3` | — | — |
| Crafting Table / Chest | `2.5` | Axe | Hand |
| Furnace | `3.5` | Pickaxe | Wood |
| Coal ore | `3.0` | Pickaxe | Wood |
| Iron ore | `3.0` | Pickaxe | Stone |
| Gold / Redstone / Diamond ore | `3.0` | Pickaxe | Iron |
| Obsidian | `50` | Pickaxe | Diamond |
| Cactus | `0.4` | — | Hand |
| Torch | `0` | — | Instant |
| Stone button | `0.5` | Pickaxe | Hand |
| Oak door | `3.0` | Axe | Hand |
| Bedrock / liquids | `< 0` | — | Unbreakable |

При смене target накопленный progress сбрасывается. После обычного, не instant, разрушения vanilla также имеет короткую паузу между блоками; для alpha это допустимо отложить. Источники: [Breaking — speed/calculation](https://minecraft.wiki/w/Breaking#Calculation), [Tiers](https://minecraft.wiki/w/Tiers), [Pickaxe](https://minecraft.wiki/w/Pickaxe), [Block hardness](https://minecraft.wiki/w/Block_hardness).

### Attack speed, base damage и cooldown

`generic.attackSpeed` означает число полностью заряженных атак в секунду. Для `AS = attackSpeed`:

```text
cooldownTicks = 20 / AS
charge        = clamp((ticksSinceAttack + 0.5) / cooldownTicks, 0, 1)
damageFactor  = 0.2 + 0.8 × charge²
dealtBase     = baseAttackDamage × damageFactor
```

Смещение `+0.5 tick` важно: отображаемый/используемый charge чуть опережает простое `elapsed / cooldown`. Attack или смена предмета сбрасывает meter. Формула release 1.9 квадратичная и даёт от `20%` до `100%` base damage.

| Предмет | Wood | Stone | Iron | Diamond | Gold | Attack speed | Full cooldown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fist / обычный предмет | `1` | — | — | — | — | `4.0` | `5 ticks` |
| Sword | `4` | `5` | `6` | `7` | `4` | `1.6` | `12.5 ticks` / `0.625 s` |
| Pickaxe | `2` | `3` | `4` | `5` | `2` | `1.2` | `16.67 ticks` / `0.833 s` |
| Shovel | `2.5` | `3.5` | `4.5` | `5.5` | `2.5` | `1.0` | `20 ticks` / `1 s` |
| Axe | `7` | `9` | `9` | `9` | `7` | `0.8 / 0.8 / 0.9 / 1.0 / 1.0` | `25 / 25 / 22.22 / 20 / 20 ticks` |
| Hoe | `1` | `1` | `1` | `1` | `1` | `1 / 2 / 3 / 4 / 1` | зависит от tier |

В строках значения урона уже включают базовый `1 HP` игрока. Enchantment damage добавляется отдельным этапом и не обязан входить в первую alpha.

Повторный равный или более слабый урон обычно отсекается примерно на `10 ticks` (`0.5 s`) после попадания. Vanilla-механика hurt resistance сложнее полного иммунитета: более сильный hit в этом окне может применить только превышение над предыдущим damage.

Источники: [Java Edition 1.9 — combat/tool table](https://minecraft.wiki/w/Java_Edition_1.9#Gameplay), [Damage — attack cooldown](https://minecraft.wiki/w/Damage#Attack_cooldown), [Attribute](https://minecraft.wiki/w/Attribute).

### Critical hit

Melee critical в Java 1.9:

- множитель — `×1.5` к base damage после Strength, но до armor; enchantment bonus не умножается;
- игрок падает (`fallDistance > 0`) и не стоит на земле;
- игрок не на ladder/vine, не в воде, не ослеплён и не едет на сущности;
- игрок не sprinting: sprint-knockback и critical взаимоисключающие;
- внутренний charge больше `0.9`. Через quadratic damage formula это соответствует не менее чем примерно `84.8%` base damage.

Источник: [Damage — critical hit](https://minecraft.wiki/w/Damage#Critical_hit), [Melee attack](https://minecraft.wiki/w/Melee_attack).

### Knockback и sprint-knockback

Базовая Java-схема после успешного hit, если knockback resistance не сработал:

```text
target.horizontalVelocity /= 2
target.horizontalVelocity += awayFromAttacker × 0.4 block/tick

if target was grounded:
  target.vy = min(target.vy / 2 + 0.4, 0.4) block/tick
```

С 15w49a airborne target не получает новую vertical component обычного knockback. Sprint-knockback требует того же порога charge `> 0.9` (`≈84.8%` damage), добавляет дополнительный горизонтальный импульс, отменяет sprint атакующего и имеет отдельный звук. В vanilla extra level от sprint/Knockback enchantment добавляет примерно `0.5 block/tick` по facing и небольшой `+0.1` vertical impulse; горизонтальная скорость атакующего после такого удара умножается примерно на `0.6`.

В 1.9 knockback resistance — вероятность полностью проигнорировать knockback, а не современное линейное масштабирование. Источник: [Knockback mechanic](https://minecraft.wiki/w/Knockback_%28mechanic%29), [15w49a](https://minecraft.wiki/w/Java_Edition_15w49a).

### Shield и axe vs shield — именно 1.9

- Shield активируется после `5 ticks = 0.25 s` удержания use.
- Во время use скорость ограничивается sneak pace.
- Защита направленная, примерно передняя полусфера; атака сзади не блокируется.
- **Release 1.9 блокирует 66% melee damage**, а не 100%. Полный melee block — изменение 1.11 snapshot 16w35a.
- Обычные стрелы спереди полностью отражаются; многие blockable secondary effects также подавляются.
- Удар axe отключает shield на `5 s = 100 ticks` с шансом:

  ```text
  chance = 25% + 5% × EfficiencyLevel + (75% if attacker is sprinting)
  ```

- Sprinting axe без Efficiency тем самым достигает `100%`.

Источники: [Blocking](https://minecraft.wiki/w/Blocking), [Shield history](https://minecraft.wiki/w/Shield#History), [Axe — shield disabling](https://minecraft.wiki/w/Axe#Weapon), [Java Edition 1.9](https://minecraft.wiki/w/Java_Edition_1.9).

### Armor — граница между 1.9 и 1.9.1

Armor points полного комплекта:

| Material | Helmet | Chest | Legs | Boots | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Leather | `1` | `3` | `2` | `1` | `7` |
| Gold | `2` | `5` | `3` | `1` | `11` |
| Chainmail | `2` | `5` | `4` | `1` | `12` |
| Iron | `2` | `6` | `5` | `2` | `15` |
| Diamond | `3` | `8` | `6` | `3` | `20` |

Чистая **1.9 release не имела armor toughness**. Для входящего armor-reducible damage `D` и armor points `A`:

```text
effectiveArmor = min(20, max(A / 5, A - D / 2))
received       = D × (1 - effectiveArmor / 25)
```

Это значит, что сильный одиночный удар пробивает больше защиты, но effective armor не падает ниже `20%` от `A`.

В **1.9.1-pre1 / 1.9.1** появился `generic.armorToughness`; каждая diamond armor piece получила `2 toughness`. Только для этой более поздней формулы:

```text
effectiveArmor = min(20, max(A / 5, A - D / (2 + toughness / 4)))
received       = D × (1 - effectiveArmor / 25)
```

Обычный Protection в 1.9 стал линейным: каждый уровень даёт ещё `4%` reduction на оставшийся после armor damage, общий enchantment protection ограничен `80%`. Alpha может отложить enchantment pass.

Источники: [Armor — mechanics](https://minecraft.wiki/w/Armor#Damage_protection), [Java Edition 1.9.1 development versions](https://minecraft.wiki/w/Java_Edition_1.9.1/Development_versions), [Protection history](https://minecraft.wiki/w/Protection#History).

### Bow

Пусть `ticksHeld` — число ticks натяжения, а `x = ticksHeld / 20`. Vanilla draw factor:

```text
power = clamp((x² + 2x) / 3, 0, 1)
launchSpeed = 3 × power blocks/tick
```

- Полное натяжение достигается за `20 ticks = 1 s`.
- Слишком короткое натяжение (`power < 0.1`) не выпускает стрелу.
- Полностью натянутая стрела помечается critical.
- Базовый arrow damage вычисляется из скорости при попадании: примерно `ceil(speed × 2)` без Power enchantment. На близкой дистанции full charge даёт базово около `6 HP`.
- Critical arrow добавляет случайное целое от `0` до `floor(baseHit / 2) + 1`; обычный близкий full-charge shot поэтому практически лежит около `6–10 HP`, а wiki указывает возможный максимум до `11 HP` из-за скорости/округления.
- В воздухе arrow velocity каждый tick умножается на `0.99`, gravity для стрелы — `0.05 block/tick²`; проект использует water multiplier `0.6` как 1.9-style target.
- Во время натяжения игрок движется не быстрее sneak pace.

Текущая alpha хранит velocity в `blocks/tick`, делает `position += velocity`, затем применяет drag/gravity. И player, и skeleton проходят через этот общий basis. Небольшая Gaussian inaccuracy нормализуется обратно к исходной launch speed; damage зависит от фактической скорости в момент столкновения. Block hit переводит стрелу в видимый `inGround` state до восьмисекундного timeout. Critical randomness, pickup/recovery и точная vanilla orientation/model geometry пока не воспроизводятся полностью.

### Render look и item models

Java simulation tick и display refresh — разные временные шкалы. Для узнаваемого mouse feel alpha оставляет физику на `20 TPS`, но применяет накопленные input yaw/pitch к render camera каждый animation frame. Это проектный rendering contract, а не утверждение о внутреннем клиентском коде Java 1.9.

First-person transforms, Steve-arm placement и FOV easing являются визуальными alpha approximations. Обычные item sprites преобразуются в cached geometry с одним front/back quad и боковыми spans по opaque→transparent (`alpha == 0`). Это следует `item/generated`: толщина `1/16`, 32×32 в тех же 16×16 model units, outer-shell winding, collapsed UV в центре opaque texel. Не bit-exact Mojang `ItemModelGenerator`.

Источники: [Bow — weapon](https://minecraft.wiki/w/Bow#Weapon), [Arrow — damage](https://minecraft.wiki/w/Arrow#Damage).

## Alpha targets и намеренные approximations

Ниже зафиксирован текущий контракт проекта. Это **не** список подтверждённых vanilla-значений.

| Система | Alpha target | Статус относительно 1.9 |
| --- | --- | --- |
| Simulation | Fixed `20 TPS`, render отдельно | Совпадает по tick rate |
| Ground speeds | walk `4.317`, sprint `5.612`, sneak `1.295 b/s` | Числа совпадают; acceleration/friction допускаются упрощёнными |
| Player AABB | standing `0.6 × 1.8`, sneak `0.6 × 1.5` | Sneak — approximation от более новых Java, не 1.9 (`1.65`) |
| Eye | `1.62`, sneak `1.27` | Sneak — approximation; 1.9 около `1.54` |
| Jump/gravity | `8.4 b/s`, `32 b/s²` | Эквивалентны `0.42` и `0.08` per tick до учёта drag |
| Terminal velocity | `50 b/s` | Gameplay clamp; vanilla около `78.4 b/s` |
| Reach | единый `5 blocks` | Увеличенный и объединённый; vanilla `4.5` block / `3` entity |
| Mining | `S/H/30`, иначе `S/H/100`; speeds wood `2`, stone `4`, iron `6`, diamond `8` | Core formula совпадает; эффекты и post-break delay могут быть частичными |
| Gold tools | speed `12`, tier `0`, durability `32`, если включены | Exact values; gold можно исключить из раннего UI, но не подменять tier |
| Cooldown | `charge = clamp((ticksSinceAttack + 0.5) / (20 / AS), 0, 1)`; `damage = base × (0.2 + 0.8 × charge²)` | Совпадает с используемым partial-tick offset Java 1.9 |
| Attack speeds | sword `1.6`, pickaxe `1.2`, shovel `1.0`, axes `0.8/0.8/0.9/1.0/1.0` | Совпадают |
| Axe damage в текущем registry | wood `6`, stone `7`, iron `8`, diamond `9`, gold `6` | Approximation; exact 1.9: `7/9/9/9/7` |
| Critical | `×1.5` при падении и full charge | Упрощены environmental conditions; exact threshold допускает charge `>0.9` |
| Hurt i-frames | около `0.5 s` полного immunity | Approximation сложной vanilla hurt-resistance логики |
| Knockback | настраиваемый directional impulse + усиление sprint | Approximation; bit-exact momentum/netcode не заявлены |
| Shield | wind-up `5 ticks`, frontal block, axe disable `5 s` configurable | Wind-up/disable совпадают; полный block сильнее exact 1.9 melee reduction `66%` |
| Armor | armor points как выше; toughness допускается для diamond | Если toughness включён, это явно **1.9.1 variant**, не 1.9 release |
| Bow | `power=(x²+2x)/3`, clamp `1`, full `20 ticks` | Draw curve совпадает; projectile damage/randomness могут быть упрощены |
| Arrow flight | velocity в blocks/tick; air `×0.99`; water `×0.6`; gravity `-0.05/tick`; continuous segment hit | Player/skeleton basis унифицирован; exact critical random/pickup/model не заявлены |
| Render look | live input yaw/pitch каждый RAF, simulation `20 TPS` | Осознанное client-feel разделение, не simulation change |
| Bow presentation | 3 pulling textures, до `-8°` FOV, movement `×0.2` | Визуальный/FOV alpha target; draw curve остаётся reference-формулой |
| Generated items | alpha silhouette front/back + merged side spans, depth `0.08` | Приближение generated model, не bit-exact Mojang geometry/UV |

При балансировке сначала сохраняем узнаваемый loop и deterministic `20 TPS`. Любое дальнейшее отклонение от таблицы должно называться alpha approximation и фиксироваться здесь; нельзя молча выдавать современную Java-механику за 1.9.

## Основные источники

- [Minecraft Wiki: Java Edition 1.9](https://minecraft.wiki/w/Java_Edition_1.9)
- [Minecraft Wiki: Damage](https://minecraft.wiki/w/Damage)
- [Minecraft Wiki: Breaking](https://minecraft.wiki/w/Breaking)
- [Minecraft Wiki: Armor](https://minecraft.wiki/w/Armor)
- [Minecraft Wiki: Blocking](https://minecraft.wiki/w/Blocking)
- [Minecraft Wiki: Bow](https://minecraft.wiki/w/Bow)
- [Minecraft Wiki: 1.9.1 development versions](https://minecraft.wiki/w/Java_Edition_1.9.1/Development_versions)
