# Ориентация текстуры пчелы

## Goal

Жёлтая морда и глаза должны быть на -Z, тёмное брюшко на +Z, полосы обеих сторон направлены одинаково, кончик крыла смотрит наружу. Масштаб, высота, idle, `/spawnpet off`, лист `bee.png` и мини-крипер не меняются.

## Result

Боковые грани корпуса получили `faceUvFlipU`, верх — `faceUvFlipV`. У обоих крыльев перевёрнут только U верхней грани. Корень модели, yaw и знак наклона крыльев не разворачивались.

## Implemented

- `LegacyModelBox` передаёт `faceUvFlipU` и `faceUvFlipV` в `TexturedCuboidDefinition`.
- `faceUvFlipV` меняет только V одной грани. Вызовы без поля сохраняют прежний порядок.
- Ключ кеша геометрии по-прежнему `JSON.stringify(definition)`.
- Тест читает world position → UV → пиксель `bee.png`, а не только метаданные flip.

## Changed files

- `src/rendering/TexturedCuboid.ts`
- `src/entities/LegacyModel.ts`
- `src/entities/beeModel.ts`
- `tests/cosmetic-bee-visual.test.ts`
- `tests/visual-models.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/MOB_MODEL_REFERENCE.md`

## Architecture decisions

Порядок вершин `TexturedCuboid` не менялся: у left и right разный обход Z, поэтому один и тот же флаг U нужен обеим граням по разным причинам. Верх нельзя починить тем же U-flip: на верхней грани U идёт по X, а перед/зад — по V. Низ уже кладёт жёлтый край на -Z. Разворот корня на 180° сдвинул бы усики и жало.

Наклон крыльев по X оставлен отрицательным в Three.js: он поднимает мембрану над грудью. Yaw ±15° оставлен. Направление «острия» было ошибкой UV верхней грани, не знаком yaw.

## Tests

`maps yellow head texels to -Z and the wing tip outward` строит модель через `ThreeEntityHost` и сэмплирует геометрию.

## Visual QA

Браузерный WebGL в этой среде не гонялся. На DEV всё ещё нужно посмотреть пчелу спереди, сзади, слева, справа и сверху, и один цикл взмаха.

## Performance

Новых мешей и проходов нет. Кеш кубоида различает flip по JSON ключу.

## Known issues

Права на оригинальный `bee.png` по-прежнему нужны до публичного выпуска.

## Deferred

Нет.

## Next work

Визуальная приёмка на DEV.

## Git

Ветка `cursor/cosmetic-bee-mini-creeper-pets-e355`. Draft PR #133. Не смержен.
