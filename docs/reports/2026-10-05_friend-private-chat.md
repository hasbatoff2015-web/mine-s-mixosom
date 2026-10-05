# Личные сообщения друзей

Дата: 2026-10-05.

## Goal

Добавить постоянный личный чат между взаимными друзьями внутрь существующего меню «Друзья». Это не четвёртый канал Global / Nearby / Clan.

## Result

У каждого друга есть зелёная кнопка `Чат` непосредственно слева от `Удалить`. Если телепорт разрешён, порядок такой: `Телепорт`, `Чат`, `Удалить`. Экран `friend-chat` открывается в том же меню. Сервер хранит историю, непрочитанное и порядок сообщений. Клиент не может назначить отправителя, время или id.

## Implemented

- `server/services/directMessages.ts`: `load`, `send`, `history`, `markReadThroughLatest`, `unreadCount`, `totalUnread`.
- Файл диалога: `<world>/plugin-data/friends/messages/<conversation-key>.json`.
- Ключ: лексикографическая сортировка player id, затем hex UTF-8, разделитель `--`. `A,B` и `B,A` дают один ключ. Ник в ключе не используется.
- Схема version 1: `participants`, `nextSeq`, `lastReadSeq`, `messages[]` с `messageId`, `seq`, `senderId`, `recipientId`, `text`, `createdAt`.
- После принятого сообщения seq растёт. Если сообщений больше 200, удаляются самые старые. `nextSeq` не возвращается к 1.
- Непрочитанное участника: сообщения, где `senderId !== playerId` и `seq > lastReadSeq[playerId]`.
- Открытие `friends` по-прежнему очищает только `NotificationService` категории `friends`. Непрочитанные личные сообщения остаются, пока игрок не откроет этот диалог.
- Корневой бейдж «Друзья» в снимке меню равен сохранённым friend-уведомлениям плюс `totalUnread`. `totalUnread` считает только текущих друзей, поэтому после удаления из друзей бейдж не залипает. Файл диалога при этом остаётся.
- В строке друга сервер отдаёт `unreadCount`. Бейдж использует `formatNotificationBadge`: 1–99 как есть, дальше `99+`.
- История открывается последними 50 сообщениями, от старых к новым. Следующая страница — до 50 сообщений с `beforeSeq`.
- Текст: убрать управляющие символы и переводы строк, затем `normalizeOutgoingChatText`. Пустое и длиннее 128 отклоняются. `/home` остаётся текстом.
- Лимит частоты: token bucket, 5 сообщений, пополнение 1 в секунду, только в памяти.
- `messageId` — `crypto.randomUUID()`, `createdAt` — `Date.now()`, порядок — `seq`.
- Ошибки: «Игрок больше не находится у вас в друзьях.», «Слишком много сообщений. Подождите немного.», «Введите сообщение.», плюс существующая ошибка длины чата.
- Клиентский экран: заголовок `Чат с <ник>`, статус Онлайн/Оффлайн, тёмная история, входящие слева `#2c3036`, исходящие справа `#24412d`, композер высотой 20 и кнопка `Отправить`. HTML текста экранируется. Черновик чистится только после authoritative `append` с тем же текстом.
- Пока открыт тот же чат, обновление меню патчит заголовок и статус, не пересоздавая поле ввода. Переход из списка друзей копирует высоту панели, поэтому окно не меняет размер.

## Changed files

- `shared/directMessages.ts`, `shared/protocol.ts`, `shared/gameMenu.ts`
- `server/services/directMessages.ts`, `server/services/gameMenu.ts`, `server/services/gameMenuActions.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `src/ui/GameUI.ts`, `src/ui/gameMenuGui.ts`, `src/ui/containerTheme.ts`, `src/style.css`, `src/core/Game.ts`, `src/main.ts`, `src/dev/UiQaHarness.ts`
- `tests/direct-messages.test.ts`, `tests/server/direct-messages.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Личные сообщения не добавлены в `CHAT_CHANNELS` и не идут через `deliverPlayerChat`.
- `PROTOCOL_VERSION` остаётся 4. Новый тип пакета аддитивный: старый клиент его не отправляет, а неизвестный входящий пакет существующий клиент пропускает без разрыва сессии. Поднимать версию значило бы запретить вход старым клиентам.
- SQLite не добавлялся. `scripts/build-server.mjs` по-прежнему целится в Node 20, нативных зависимостей нет.
- Неизвестная `version` файла не перезаписывается. Битый JSON одной будущей отправкой заменяется новым диалогом, чтобы сервер не падал. Невалидные записи внутри version 1 пропускаются, валидные сохраняются.
- `FriendsService` не удаляет файл переписки.

## Tests

Команды запускались локально. GitHub Actions в репозитории нет: `GitHub CI is not configured; tests were local.`

- `npx vitest run tests/direct-messages.test.ts tests/server/direct-messages.test.ts tests/game-menu-gui.test.ts tests/server/friends.test.ts tests/server/game-menu.test.ts tests/server/friend-join-chat.test.ts tests/chat-channels.test.ts tests/player-chat-bubble.test.ts tests/server/menu-notifications-auction-history.test.ts tests/server/chat-channels.test.ts tests/chat-commands.test.ts tests/server/chat-scroll.test.ts tests/chat-layout.test.ts tests/online-session-transition.test.ts` — 14 files, 123 tests, PASS.
- `npx vitest run tests/server/anarchy-server.test.ts -t "resuming a live player rejects the old connectionId"` — 1 passed, 27 skipped, PASS.
- `npx tsc --noEmit`, `tsc -p tsconfig.client.json`, `tsc -p tsconfig.server.json` — PASS.
- `node scripts/check-import-boundaries.mjs` — PASS.
- `npm run build` — PASS. Client JS 1,637.40 kB, CSS 109.98 kB.
- `npm run build:server` — PASS. `dist/server/index.mjs` 1.5mb. Цель Node не менялась.

## Visual QA

DEV `http://localhost:5173/?qaUi=menu-friends`, headed Chrome на `DISPLAY=:1` и тот же Chrome с viewport 844×390.

- Desktop inner 1274×711, scale 2.5: панель друзей 620×644. После клика `Чат` панель осталась 620×644. `ThirteenChars` и `AnotherPlayer` без ellipsis (`scrollWidth === clientWidth`). Кнопки `Телепорт` 97×50, `Чат` 80×50, `Удалить` 89×50, текст не обрезан, ряд не выходит за панель. `Чат` имеет `mc-btn-positive`. Заголовок `Чат с ThirteenChars` без ellipsis. Поле ввода высотой 50 (20×2.5).
- Landscape viewport 844×390, scale 1: панель 248×258 до и после открытия чата. `Телепорт` 39×20, `Чат` 32×20, `Удалить` 36×20, текст не обрезан. Поле ввода высотой 20. `Чат с BestFriend` показывает `Оффлайн`.
- История после открытия прижата к низу (зазор около 0). Сообщение при `scrollTop = 0` оставляет `scrollTop` равным 0. У нижнего края зазор после нового сообщения около 0.
- Текст `<img src=x onerror=alert(1)>` виден как текст, элементов `img` в истории нет.
- `Отправить` добавляет исходящее `привет` и очищает поле. Назад возвращает список. X закрывает меню.
- Отдельный экран `?qaUi=menu-friend-chat` без предыдущего списка друзей использует CSS-высоту `268 * scale`. Список друзей content-sized, поэтому переход из живого списка копирует измеренную высоту и не прыгает.

Виртуальная клавиатура телефона и два полноценных игровых клиента через «Играть онлайн» в браузере не проверялись. Доставка между двумя соединениями, офлайн, restart, чужой игрок, подмена `connectionId` и отсутствие world-chat bubble проверены `WorldInstance` в `tests/server/direct-messages.test.ts`. Подмена сессии также покрыта `tests/server/anarchy-server.test.ts`.

## Performance

200 сообщений по 128 символов `я` занимают 84138 байт pretty-printed JSON (`DM_FILE_BYTES_MAX`). Короткий прогон на 201 сообщение дал 33634 байт. Запись происходит только на send/read, не на игровом тике. Одновременно у игрока не больше 50 друзей, в файле не больше 200 сообщений. Синхронный `JsonFileStore` для этого размера приемлем: это один маленький rename, не общий `messages.json`.

## Known issues

- Если чат открыт не из уже отрисованного списка друзей, высота берётся из CSS `268 * scale`, а не из текущей высоты списка. Список друзей сам по себе content-sized и зависит от числа строк.
- Битый JSON всего файла при следующей успешной отправке заменяется новым диалогом. Неизвестная числовая version не затирается.

## Deferred

- SQLite и любая смена production bundle target.
- Удаление переписки при unfriend.
- Отдельный мобильный layout.

## Next work

Ждать команду на merge. Не мержить самостоятельно.

## Git

Ветка `cursor/friend-private-chat-7fd5` от `origin/main` `49e782d841b023593a76e31b180f51073d000cee`. Draft PR. Production не менялся.
