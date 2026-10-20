# Автоматический каталог скинов

## Goal

Новый PNG 64×64 в `public/textures/player/skins/` должен сам становиться игровым скином для меню, 3D-вида и онлайн-сервера. Ручной список в `builtinSkins.ts` больше не нужен.

## Result

Каталог строится на сборке из папки PNG и пишется в `src/player/appearance/generatedPlayerSkins.ts`. Этот модуль импортируют клиент и сервер. В меню 64 игровых скина. `buyer_merchant` и `player_uv_test` в выбор не входят. `frontier_explorer` остаётся скином по умолчанию. Из двадцати ранее незарегистрированных PNG остались 19: 6 classic и 13 slim. `10126ef69e2cdfdf` удалён по решению владельца: дополнительные слои рукавов выглядели плохо, текстуру не исправляли. Неоднозначных моделей нет.

## Implemented

- `scripts/player-skin-png.mjs` — общий декодер PNG, UV-маски, классификатор Classic/Slim и сканер альфы.
- `scripts/generate-player-skins.mjs` — генератор и режим `--check`.
- `src/player/appearance/playerSkinModelOverrides.json` — модели уже выпущенных 45 скинов и NPC, плюс binary-замок внешнего слоя скупщика.
- `builtinSkins.ts` по-прежнему отдаёт `PRODUCTION_PLAYER_SKINS` и функции проверки id.
- `npm run dev`, сборки, typecheck и test запускают генератор. `npm run check` сначала делает `skins:check`.
- Vite по-прежнему отдаёт `virtual:player-skin-content-hashes` и при изменении PNG пересобирает каталог.

## Changed files

- `scripts/player-skin-png.mjs`, `scripts/generate-player-skins.mjs`, `scripts/player-skin-content-hashes.mjs` и их `.d.mts`
- `scripts/validate-player-skin-alpha.mjs`, `vite.config.ts`, `package.json`
- `src/player/appearance/builtinSkins.ts`, `generatedPlayerSkins.ts`, `playerSkinModelOverrides.json`
- `tests/player-skin-catalog.test.mjs`, `tests/player-skin-selector-menu.test.ts` и обновлённые skin/server тесты
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

Один data-only модуль, без второго реестра и без чтения диска в браузере или в уже собранном сервере. Id — имя файла без `.png`, путь `player/skins/<id>`. `player_uv_test` не лежит в папке скинов и добавляется в `builtinSkins.ts` как раньше. `buyer_merchant` читается из папки, но роль NPC не пускает его в production whitelist.

Модель новых скинов определяется по двум базовым рукавам. Classic закрашивает 16px остров, slim — левые 14px. Если оба рукава согласны, результат записывается. Если нет, скин всё равно регистрируется как classic и генератор печатает предупреждение. Точечный override не обязан перечислять все PNG.

Внешний слой получает `translucent` только при промежуточной альфе внутри UV внешнего слоя. У скупщика такой пиксель один; материал оставлен binary, чтобы не сменить уже отгруженный cutout NPC.

## Tests

`npm run typecheck`, `typecheck:client` и `typecheck:server` прошли. `typecheck:sim` падает теми же ошибками DOM/`TextureAtlas`, что и на `origin/main` `9bd569e`; это не регрессия каталога. `check:boundaries`, `skins:check`, `assets:validate-player-skins`, `build`, `build:server`, `check:size` и `check:archive` прошли. Сборка 11.72 MiB. В клиентском и серверном бандле есть новые id `14fcedd090af47a4` и `5a90d9efb3029994`. Серверный бандл не содержит Vite virtual module.

`npm test`: 3413 passed, 26 failed, 1 skipped. Падения те же посторонние: лук, God Sword, тайминг `entity_use`, меню, оверлеи ломания, SFX и генератор текстуры меча. Новые тесты каталога в этот список не входят.

`npm run test:server`: 837 passed, 4 failed, 1 skipped. Четыре падения — God Sword, два теста pet hit и отмена натяжения лука. Тест нового skin id прошёл.

## Visual QA

Браузерный 3D не запускался. Автоматически проверены карточки меню в happy-dom: 65 кнопок, модели slim/classic на canvas, клик, Cancel и Confirm. Сетку и внешний вид должен принять владелец игры.

## Performance

Сканирование 66 PNG занимает около 150 мс и происходит только при генерации. В рантайме нет обхода папки, новых сетевых запросов и новых зависимостей. В бандл добавляются только строки дескрипторов. Ленивая загрузка текстур и content-hash URL сохранены.

## Known issues

Классификатор не обещает модель, если рукава пустые или противоречат друг другу: тогда classic и предупреждение. Один промежуточный пиксель внешнего слоя включает translucent-материал на весь слой (`1e8fa3ce56f39d6c`). Старый клиент против нового сервера или наоборот отвергнет неизвестный id. `git push` не обновляет уже запущенную игру. Сохранённый `10126ef69e2cdfdf` больше не в каталоге и при загрузке заменяется на `frontier_explorer`.

## Deferred

Ручной QA меню, ширины рук, полупрозрачного слоя и второго онлайн-клиента. Отдельного редактора скинов нет.

## Next work

Владелец проходит QA-план из Final Report. После явной команды можно мержить. Следующий PNG кладётся в папку и едет вместе с перегенерированным каталогом в обеих сборках.

## Git

Ветка `cursor/automatic-player-skin-catalog-b3b8` от `origin/main` `9bd569e2e1768cc1cbe5258da5e669deb9630dde`. Draft PR #134: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/134. В main не влито.
