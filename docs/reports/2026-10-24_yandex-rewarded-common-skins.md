# Rewarded-реклама для обычных скинов

## Goal

Подключить настоящий `ysdk.adv.showRewardedVideo` для 39 обычных скинов. Успешный `onRewarded` даёт право один раз надеть выбранный `skinId`. Постоянной разблокировки нет. Редкие, эпические и легендарные скины, платежи и PR #129 не входят в задачу.

## Result

Кнопка «Смотреть рекламу» вызывает ролик на уже созданном SDK. Скин меняется только после `onRewarded` и сохраняется прежним `fc.player.appearance`. Отмена, ошибка и отсутствие SDK оставляют старый скин. Повторный callback не выдаёт скин второй раз. Возврат к ранее надетому обычному скину снова требует рекламу.

Это клиентский этап. Сервер по-прежнему принимает зарегистрированный `skinId` и в `join.appearance`, и в пакете `appearance`. `onRewarded` не является подписью Яндекса. Публичный запуск магазина этим PR не открывается.

## Implemented

- `YandexGamesService.showRewardedVideo` вызывает `adv.showRewardedVideo({ callbacks })` и не делает повторный `YaGames.init()`. `showFullscreenAdv` не используется.
- `RewardedSkinFlow` — одна операция: `idle`, `requesting`, `ad_open`, `reward_received`, `finishing`, `success`, `cancelled`, `error`. Один `skinId` захватывается на старте. Один таймер закрывает зависший запрос. Повторный `onRewarded`, поздний callback и callback после `dispose` награду не дают.
- `SkinRewardController` — единственный путь от награды к `Game.setPlayerAppearance`. Обычный Confirm рекламный скин не надевает.
- `resolveSkinActionState` добавляет `request_rewarded_ad`. Флаг `rewardedAds` разрешает запрос, а не выдачу. `advertisementReady` отдельно включает кнопку.
- Показ из главного меню не переводит `MENU` в `PLAYING` и не вызывает лишний `GameplayAPI.start()`. Если ролик прервёт уже идущий мир, пауза держится до конца ролика. Скрытая вкладка звук не включает. Pause menu не закрывается.

## Changed files

- `src/yandex/YandexGamesService.ts`
- `src/yandex/rewardedPresentation.ts`
- `src/player/appearance/rewardedSkinFlow.ts`
- `src/player/appearance/skinRewardController.ts`
- `src/player/appearance/skinActionState.ts`
- `src/player/appearance/skinMonetizationContracts.ts`
- `src/player/appearance/PlayerSkinSelector.ts`
- `src/ui/GameUI.ts`
- `src/core/Game.ts`
- `src/core/Lifecycle.ts`
- `server/WorldInstance.ts` — только комментарий. Whitelist не менялся.
- `tests/rewarded-skin-flow.test.ts`
- `tests/rewarded-skin-selector.test.ts`
- `tests/yandex-rewarded-video.test.ts`
- `tests/player-skin-selector.test.ts`
- `tests/skin-store-catalog.test.ts`
- `docs/SKIN_STORE.md`, `docs/YANDEX_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

Меню скинов открывается до онлайн-сессии. Обязательный server ACK сделал бы смену из главного меню невозможной, поэтому на этом этапе награду фиксирует клиент, а результат пишет существующий `PlayerAppearance`. Отдельный список «навсегда открытых» скинов не заводится.

`requestId` связывает callback с одним запросом и не доказывает просмотр. Будущий серверный permit описан в `FutureServerSkinSwitchPermit`: своя сессия, один `skinId`, одно использование, срок. Он не выдаётся и не проверяется. `evaluateServerSkinEquip` по-прежнему не вызывается из `join` и `setAppearance`.

Редкие и эпические кнопки остаются «Покупки скоро». Легендарные — «Недоступно». Платежи не вызываются.

## Callbacks

- `onOpen`: ролик открыт. Внешний вид и сохранение не меняются. Кнопка ждёт.
- `onRewarded`: просмотр засчитан для захваченного `skinId`. Повторный вызов вторую выдачу не создаёт. Сам по себе внешний вид ещё не пишет, пока flow не завершится.
- `onClose`: ролик закрыт. Без предшествующего `onRewarded` это отмена, даже если `wasShown === true`. С наградой — ровно одна смена. Повторный `onClose` ничего не добавляет.
- `onError`: без награды выдача не происходит, кнопка возвращается. Ошибка после уже завершённой операции её не отменяет. Ошибка после `onRewarded`, но до `onClose`, награду не стирает: закрытие или короткий таймаут завершают одну смену.

Если callback не приходит, ожидание ограничено: 15 с до открытия, 120 с на открытый ролик, 8 с после награды без закрытия. Кнопка не остаётся заблокированной.

## Tests

Целевые тесты скинов, appearance и нового flow прошли. `typecheck`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `skins:check`, `assets:validate-player-skins`, `build`, `build:server`, `check:size`, `check:archive` прошли.

Полный `npm run test`: 364 файла прошли, 13 упали, 28 тестов. `npm run test:server`: 90 файлов прошли, 3 упали. Те же падения воспроизводятся на `origin/main` `c8da9fc`: боевая интеграция, вагонетка, забор, God Sword, питомцы, броня, частицы, SFX, оверлеи ломания, PIL для иконки рейтинга. К этому PR они не относятся.

## Visual QA

Chrome headless, production preview. Desktop 1366×768 и телефон 844×390. «Отмена» и кнопка действия на одной линии. Портрет 390×844 показывает «Поверните устройство». Настоящий черновик Яндекса не открывался: ролика Яндекса в этой среде нет. Проверка настоящего `showRewardedVideo` в черновике — NOT RUN.

## Performance

В покое таймеров и запросов нет. Один таймер живёт только пока открыт ролик. Новых таблиц, polling и WebGL-рендереров нет. Архив 12.52 MiB, 473 файла. Предыдущий отчёт по main указывал 12.51 MiB и те же 473 файла. JS production: 1,785.38 kB, gzip 511.43 kB.

## Known issues

Серверный пакет `appearance` и `join.appearance` по-прежнему надевают любой зарегистрированный id, включая редкий, эпический и легендарный. Модифицированный клиент может прислать этот пакет без просмотра. Обычный UI так сделать не может.

## Deferred

Серверная одноразовая операция на своей сессии. Платежи, SKU, `payments.purchase`, `getPurchases`, админская привязка легендарных скинов. Загрузка архива в черновик Яндекса.

## Next work

Владелец собирает архив из этого коммита и загружает его в черновик. В черновике нужно досмотреть настоящий ролик, прервать ролик и перезагрузить страницу. До публичного запуска нужна серверная проверка, которая не ломает уже надетый скин и выбор из меню без соединения.

## Git

Ветка `cursor/yandex-rewarded-common-skins` от `origin/main` `c8da9fc`. PR #129 не менялся. Merge и deploy не выполнялись.
