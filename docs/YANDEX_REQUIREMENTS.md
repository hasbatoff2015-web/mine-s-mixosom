# Требования Яндекс Игр для проекта

Проверено по официальной документации: **2026-08-16**. Основная страница требований обновлена Яндексом **2026-07-01**. Это рабочий release checklist, а не замена актуальной модерационной документации; перед каждой публикацией ссылки ниже следует проверить ещё раз.

Обозначения:

- **Required** — прямое требование платформы или обязательное условие используемого SDK API.
- **Project policy** — выбранный в проекте способ выполнить требование надёжно.

## Блокирующий checklist перед отправкой

- [ ] Yandex Games SDK подключён из разрешённого path и `YaGames.init()` завершился без ошибки.
- [ ] Игра остаётся запускаемой локально, если `YaGames` отсутствует или SDK временно недоступен.
- [ ] `ysdk.features.LoadingAPI.ready()` вызывается только когда исчезли все loading screens и меню уже интерактивно.
- [ ] `GameplayAPI.start()`/`stop()`, если используются, точно соответствуют реальному PLAYING/PAUSED состоянию.
- [ ] Обрабатываются `game_api_pause` и `game_api_resume`; startup ad не запускает звук или simulation раньше resume.
- [ ] Guest может играть без авторизации, а его мир и настройки сохраняются после refresh.
- [ ] Progress сохраняется после значимых изменений, при смене orientation и до ухода в ad/background.
- [ ] При потере focus, сворачивании, смене вкладки и во время fullscreen/rewarded ad gameplay и весь audio остановлены.
- [ ] Touch-версия полностью управляется жестами; long press, selection, context menu, page scroll и swipe-to-refresh отключены в игровой области.
- [ ] Desktop управляется keyboard/mouse; правый клик в canvas не открывает context menu.
- [ ] Resize/orientation не растягивают canvas, не обрезают и не перекрывают HUD/кнопки/текст.
- [ ] Для проекта выбран `landscape`; portrait безопасно показывает rotate overlay без перезагрузки мира.
- [ ] Production ZIP содержит ровно один `index.html` в корне.
- [ ] Имена production-файлов и папок не содержат пробелов или кириллицы/русских символов.
- [ ] Суммарный **uncompressed** размер всех файлов архива не превышает `100 MB`.

## SDK: подключение и initialization

**Required:** SDK обязателен для успешной модерации. Для архива, размещаемого на сервере Яндекс Игр, рекомендуемый официальный path:

```html
<script src="/sdk.js"></script>
```

После загрузки script:

```ts
const ysdk = await YaGames.init();
```

Если игра размещена на собственном domain через согласованную iframe-интеграцию, официальный absolute path другой:

```html
<script src="https://sdk.games.s3.yandex.net/sdk.js"></script>
```

Нельзя скачивать `sdk.js` в build или подключать неофициальную копию. `/sdk.js` должен быть загружен до вызова `YaGames.init()`. Также требование 1.7 запрещает hardcoded absolute URL на Yandex S3 для обычных игровых ресурсов; assets проекта должны разрешаться из собственного build.

**Project policy:** `YandexGamesService` ловит ошибку загрузки/init и переходит в local no-op adapter. Ошибка платформы не должна блокировать main menu, IndexedDB save или local development. В platform build SDK всё равно считается обязательным: fallback не маскирует отсутствие интеграции при release audit.

Источники: [Connection and usage](https://yandex.com/dev/games/doc/en/sdk/sdk-about), [Game requirements, items 1.1, 1.7, 1.19](https://yandex.com/dev/games/doc/en/concepts/requirements), [TypeScript integration](https://yandex.com/dev/games/doc/en/sdk/typescript).

## Game Ready: `LoadingAPI.ready()`

**Required:** вызвать:

```ts
ysdk.features.LoadingAPI?.ready();
```

только когда одновременно выполнены условия:

- загружены обязательные ресурсы первоначального экрана;
- нет собственного loading overlay/screen;
- все видимые элементы готовы к interaction;
- пользователь уже может пользоваться menu либо начать gameplay.

Нельзя привязывать вызов к таймеру, проценту прогресс-бара или самому завершению `YaGames.init()`. Вызов должен отражать реальную готовность даже если пользователь вручную скрыл loader Яндекса. Метод следует посылать один раз за boot после появления интерактивного UI.

Источник: [Game loading and gameplay markup](https://yandex.com/dev/games/doc/en/sdk/sdk-game-events), [moderation check for item 1.19](https://yandex.com/dev/games/doc/en/requirements/1/19).

## Gameplay lifecycle

`GameplayAPI` markup формально optional, но если проект его использует, моменты вызова должны быть точными.

| Переход | Состояние игры | SDK call |
| --- | --- | --- |
| Boot / asset loading | `LOADING` | Нет gameplay call |
| Интерактивное main menu / world list | `MENU` | `GameplayAPI.stop()` только если ранее было PLAYING |
| Мир загружен, player получил управление | `PLAYING` | `ysdk.features.GameplayAPI?.start()` |
| Pause menu (настоящая остановка simulation) | `PAUSED` | `...stop()` |
| Inventory / chest / furnace / crafting (modal, мир тикает) | `PLAYING` | `start()` остаётся активным |
| Перед fullscreen/rewarded ad | `AD` | Save, затем `...stop()` |
| Потеря вкладки/focus/minimize | `BACKGROUND` | `...stop()` |
| Возврат из ad/background | предыдущее логическое состояние | `...start()` только если реально возобновляется gameplay |
| Death/menu/world exit | `PAUSED` или `MENU` | `...stop()` |

`start()` посылается, когда gameplay **сразу** начинается или возобновляется: старт мира/уровня, закрытие menu, unpause, возврат после ad или в активную вкладку. `stop()` посылается, когда gameplay **сразу** остановлен: pause/menu, завершение/поражение, показ ad, смена вкладки.

### Platform events

Подписки:

```ts
ysdk.on('game_api_pause', handlePlatformPause);
ysdk.on('game_api_resume', handlePlatformResume);

// При teardown обязательно тот же callback reference:
ysdk.off('game_api_pause', handlePlatformPause);
ysdk.off('game_api_resume', handlePlatformResume);
```

События покрывают fullscreen/rewarded ads, purchase windows, смену вкладки и minimize/maximize. Платформа сама согласует их с gameplay markup: pause соответствует `GameplayAPI.stop()`, resume — `start()`. Внутренний lifecycle manager должен быть idempotent и хранить несколько причин паузы, например `userPaused`, `platformPaused`, `documentHidden`, `adOpen`. `game_api_resume` не имеет права закрывать пользовательское pause menu.

Особенно важно: Яндекс может автоматически показать fullscreen ad при старте. У него нет обычных ad callbacks, поэтому audio/simulation запускаются только если не пришёл `game_api_pause`, либо после `game_api_resume`.

Источники: [GameplayAPI start/stop](https://yandex.com/dev/games/doc/en/sdk/sdk-game-events), [Pause and Resume Events](https://yandex.com/dev/games/doc/en/sdk/sdk-events), [debug panel](https://yandex.com/dev/games/doc/en/console/debug-panel).

## Guest play, authorization и saves

### Обязательное поведение

- Игра запускается и остаётся функциональной без регистрации или login.
- Если предлагается Yandex ID authorization, dialog открывается только после очевидного добровольного действия пользователя.
- Перед dialog объясняется выгода, например cloud sync; предложение можно отклонить и продолжить игру.
- Для guest progress сохраняется так же, как для authorised player.
- Refresh не должен терять достижения, record или мир.
- Progress сохраняется сразу после значимого действия либо явной кнопкой Save. Если используется другая схема, её нужно описать в developer note.
- На mobile состояние сохраняется при смене orientation.
- Если cloud saves включены, это отмечается в draft.

Источники: [Authorization requirement](https://yandex.com/dev/games/doc/en/requirements/1/2), [Progress saving requirement](https://yandex.com/dev/games/doc/en/requirements/1/9), [Player data SDK](https://yandex.com/dev/games/doc/en/sdk/sdk-player).

### Project save policy

Primary save для большой voxel-world alpha — versioned IndexedDB:

```text
seed + settings + player/inventory + time
+ modified chunk deltas + block entities + persistent entities
```

Не сохранять целые неизменённые procedural chunks. Запись должна быть atomic/versioned. Dirty state сохраняется после изменения мира/inventory, create/load/delete world, pause, `visibilitychange`, `pagehide`, orientation change и перед ad. Периодический autosave является дополнительной страховкой, но не единственным способом выполнения requirement 1.9.

Cloud sync через `player.getData()`/`player.setData()` — дополнительный слой для authorised player, а не условие запуска. `player.setData()` ограничен `200 KB` на игрока и `100` вызовами за `5 min`; полный voxel save туда не помещается, поэтому синхронизировать следует компактный metadata/snapshot либо использовать собственный server. При `flush: true` запрос отправляется сразу; `false` ставит его в очередь.

При переходе guest → authorised нельзя молча затирать один save другим. Нужна явная merge policy: сравнить schema version и `updatedAt`, предложить выбрать local/cloud при конфликте, затем записать выбранное состояние.

Для own-domain integration на iOS официальный SDK предлагает `const safeStorage = await ysdk.getStorage()`. При archive upload wrapper Яндекса уже делает `localStorage` надёжнее; IndexedDB всё равно следует проверять в draft environment.

## Focus, background и audio

**Required:** звук прекращается при:

- minimize browser/app;
- переходе на другую вкладку;
- открытии browser tab selector;
- fullscreen/rewarded ad.

Модерация допускает задержку до 2 секунд при уходе из вкладки, но project policy — mute/pause немедленно. Останавливаются music, SFX loops, ambient, listener/context; simulation не должна продолжать накапливать большой fixed-step backlog.

Источники событий, применяемые вместе:

- `game_api_pause` / `game_api_resume` — основной platform signal;
- `document.visibilitychange` — browser fallback;
- `pagehide` — final save/background transition;
- `window.blur/focus` — дополнительный fallback, но focus сам по себе не должен отменять menu/ad pause.

Источник: [Sound outside the game](https://yandex.com/dev/games/doc/en/requirements/1/3), [SDK events](https://yandex.com/dev/games/doc/en/sdk/sdk-events).

## Ads

- Ads вызываются только через Yandex Games SDK.
- Fullscreen ad показывается только в логической паузе, не поверх активного mining/combat/input.
- До вызова: сохранить progress, снять pointer lock, остановить simulation, вызвать gameplay stop, pause/mute audio.
- После закрытия: вернуть игру только в ранее сохранённое состояние; не resume, если открыто pause menu, вкладка скрыта или мир ещё не готов.
- После клика по рекламе и возврата progress должен сохраниться.
- Orientation ad unit совпадает с orientation игры.
- Rewarded video добровольна; UI заранее ясно показывает сам факт рекламы и конкретную награду. Награду выдавать только в `onRewarded`, не в `onClose`.
- Interstitial callbacks: `onOpen`, `onClose(wasShown)`, `onError`. Rewarded callbacks: `onOpen`, `onRewarded`, `onClose`, `onError`.
- Startup fullscreen ad обрабатывается через platform pause/resume events, потому что прямых callbacks у него нет.

Источники: [Advertising SDK](https://yandex.com/dev/games/doc/en/sdk/sdk-adv), [Ad requirements](https://yandex.com/dev/games/doc/en/concepts/requirements#ad-requirements), [Ad placement](https://yandex.com/dev/games/doc/en/requirements/4/4).

## Gestures, keyboard и browser-native actions

### Mobile — Required

- Игра полностью проходима жестами без keyboard/mouse.
- Во время launch/gameplay используется full-screen active area.
- Tap по input field вызывает system keyboard.
- Long tap не выделяет страницу и не открывает context menu.
- Не появляется system media player или WebGL warning.

### Desktop — Required

- Active area растягивается по доступной ширине или высоте без disproportionate distortion.
- Keyboard/mouse покрывают весь gameplay.
- Не перехватывать OS/browser shortcuts для игровых действий.
- Взаимодействие с игровым полем не выделяет DOM и не открывает context menu.

### Project policy для canvas/game UI

```css
html, body, #app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  overscroll-behavior: none;
}

canvas, .game-controls {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
```

Дополнительно отменять `contextmenu` только внутри игрового root; использовать Pointer Events и `setPointerCapture`; каждый touch button должен иметь собственный неперекрывающийся hit area. `touch-action: none` не ставить на text input, где нужны стандартные editing gestures.

Источник: [Game requirements, item 1.6](https://yandex.com/dev/games/doc/en/concepts/requirements), [common rejection reasons](https://yandex.com/dev/games/doc/en/console/add-new-game).

## Responsive, resize и orientation

**Required:** при изменении viewport или orientation UI не деформируется, active area не выходит за экран, важные элементы не обрезаются и не перекрываются. Browser scrollbar и swipe-to-refresh запрещены; внутриигровой scroll допустим. Controls должны оставаться доступны без дополнительного page scrolling.

Для single-orientation игры orientation выбирается в draft; в другой orientation пользователь должен увидеть rotate prompt. Для этого проекта:

- draft orientation: `landscape`;
- portrait: fullscreen rotate overlay, simulation/audio paused, world и open UI state не пересоздаются;
- возврат в landscape: пересчитать renderer size, camera aspect, HUD и pointer hit areas, затем resume только если нет других pause reasons;
- все HUD/control offsets учитывают `env(safe-area-inset-top/right/bottom/left)`;
- canvas меняет drawing buffer под CSS size и device pixel ratio с разумным mobile cap, но не растягивает сцену;
- buttons, text, health/hunger, hotbar, inventory, chest/furnace, pause/death screens проверяются во всех заявленных размерах.

На desktop официальное требование также говорит, что длинная сторона active area не должна превышать короткую более чем вдвое. Для сверхширокого окна нужно letterbox/ограниченная игровая область, а не HUD, растянутый по всей ширине.

Источники: [Game requirements, items 1.6 and 1.10](https://yandex.com/dev/games/doc/en/concepts/requirements), [Correct display](https://yandex.com/dev/games/doc/en/requirements/1/10), [draft orientation](https://yandex.com/dev/games/doc/en/console/add-new-game/draft).

## Production archive, root и paths

Для archive upload:

```text
game.zip
├── index.html          # в корне, ровно один root index
├── assets/...
└── ...другие runtime-файлы
```

**Required:** весь контент ZIP после распаковки — не более `100 MB`. Считается сумма **uncompressed file sizes**, а не размер `.zip`. `index.html` находится прямо в root, не в `dist/` или вложенной папке. Имена production files/folders не содержат пробелов и русских/кириллических символов.

Path policy:

- SDK в Yandex-hosted archive: `/sdk.js`.
- Runtime assets/chunks: относительные к production base (`./assets/...`) либо URL, которые корректно генерирует bundler для portal path.
- Не использовать local absolute paths, drive letters, `file://`, dev-server URLs или hardcoded Yandex S3 asset URLs.
- Все ссылки проверяются после распаковки ZIP через HTTP server и в Yandex draft, не двойным кликом по `index.html`.
- Vite production base должен поддерживать размещение не только в `/`; для archive-safe build предпочтителен relative base `./`, если SDK path остаётся отдельно `/sdk.js`.
- Source pack, raw design files, tests, docs, sourcemaps и неиспользуемые assets не включаются в production archive.

Project size gate:

- warning от `90 MB` uncompressed;
- hard failure при `> 100 MB`;
- вывод общего размера и списка самых тяжёлых files;
- отдельный audit на root `index.html`, пробелы, кириллицу и case-sensitive broken paths.

Источники: [Game requirements, items 1.21–1.22](https://yandex.com/dev/games/doc/en/concepts/requirements), [Draft archive requirements](https://yandex.com/dev/games/doc/en/console/add-new-game/draft), [Connection paths](https://yandex.com/dev/games/doc/en/sdk/sdk-about).

## Обязательная QA-матрица проекта

Desktop:

- `1920×1080`, `1366×768`, `1280×720`, `1024×768`, маленькое окно;
- Pointer Lock, LMB/RMB, wheel, `1–9`, `WASD`, jump/sprint/sneak, inventory/pause;
- resize во время gameplay и при открытом modal UI;
- tab switch/minimize: нулевой audio и остановленная simulation.

Mobile landscape:

- `932×430`, `844×390`, `800×360`, `768×360`, `740×360`, `720×360`, `667×375`;
- joystick + camera drag + jump/sneak/sprint/mine/use/inventory/hotbar одновременно;
- safe areas, long press, multi-touch, отсутствие accidental selection/context menu;
- portrait → rotate overlay → landscape без потери state.

Platform:

- local run без `YaGames`;
- Yandex draft с debug panel: loader/Game Ready indicator, gameplay indicator, pause/resume button;
- startup ad, interstitial, rewarded, ad error/too-frequent close;
- guest create/save/refresh/load; orientation change; authorised cloud conflict;
- DevTools console без runtime errors;
- production ZIP audit и фактический uncompressed size.

Источник для проверки инструментами платформы: [Testing](https://yandex.com/dev/games/doc/en/console/test-game), [Debug panel](https://yandex.com/dev/games/doc/en/console/debug-panel).

## Официальные источники

- [Game requirements](https://yandex.com/dev/games/doc/en/concepts/requirements)
- [Connection and usage](https://yandex.com/dev/games/doc/en/sdk/sdk-about)
- [Game loading and gameplay markup](https://yandex.com/dev/games/doc/en/sdk/sdk-game-events)
- [SDK events](https://yandex.com/dev/games/doc/en/sdk/sdk-events)
- [Progress saving](https://yandex.com/dev/games/doc/en/requirements/1/9)
- [Player data](https://yandex.com/dev/games/doc/en/sdk/sdk-player)
- [Advertising](https://yandex.com/dev/games/doc/en/sdk/sdk-adv)
- [Archive/draft requirements](https://yandex.com/dev/games/doc/en/console/add-new-game/draft)
