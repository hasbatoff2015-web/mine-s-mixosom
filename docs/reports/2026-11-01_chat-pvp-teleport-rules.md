# Чат, цензура, телепортация, PvP и защита

## Goal

Пять серверных ограничений: частота чата, цензура, общий кулдаун телепортации, временный PvP и личная защита после телепортации.

## Result

Сервер хранит сроки по каждому игроку и не принимает обход повторным пакетом. Клиент показывает отказ только нарушителю, не закрывает меню и чат и обновляет одну PvP-плашку.

## Implemented

- Чат: 3 секунды после принятого сообщения. Раньше срока строка не рассылается и не пишется в чужую историю. Уведомление жёлтое и только отправителю. Поле ввода остаётся, если чат открыт и игрок не начал новый текст. Личные сообщения используют тот же срок и `censorChatText` до записи. Отказ уходит отправителю и срок не запускает.
- Цензура до рассылки. Словари: корни, слова, оскорбления, выражения, написания, исключения. Нормализация: регистр, NFKD, невидимые символы, повторы, разделители, похожие буквы, цифры, транслит. Звёздочек столько, сколько кодпоинтов в исходном фрагменте.
- Телепорт: общий кулдаун 5 секунд на спавн, дом, РТП, портал РТП, `/tpa` и телепорт к другу. Кулдаун пишется после успешного `teleport()`. Неудачный вызов его не запускает. Повторный вход в `now()` того же игрока отклоняется до commit.
- PvP: 10 секунд у обоих после принятого удара или стрелы. Падение, моб и удар по неуязвимости таймер не двигают. Пока срок не вышел, перечисленные телепорты не выполняются.
- Защита: 20 секунд после РТП, дома, телепорта к игроку и портала. Спавн срок не создаёт и не стирает. Проверка пары атакующий → цель. Соседи без защиты дерутся как обычно.

## Changed files

- `shared/playerRules.ts`, `shared/chat.ts`, `shared/protocol.ts`
- `server/services/playerRules.ts`, `server/services/chatCensor.ts`, `server/services/teleport.ts`, `server/services/clan.ts`
- `server/data/chat-profanity-ru.json`, `server/data/chat-profanity-en.json`
- `server/WorldInstance.ts`, `server/gameplay.ts`, `server/AnarchyServer.ts`
- `src/core/Game.ts`, `src/ui/GameUI.ts`, `src/ui/gameMenuGui.ts`, `src/style.css`
- Тесты: `tests/chat-censor.test.ts`, `tests/player-rules.test.ts`, `tests/server/pvp-chat-teleport.test.ts`, правки `tests/server/chat-channels.test.ts` и `tests/server/anarchy-plugins.test.ts`

## Architecture decisions

Один `PlayerRules` и существующий `TeleportService` / `hurtPlayerResult` / `handleChat`. Нового протокола чата нет: отказ — `chat` со `style: 'notice'`. Срок PvP уходит личным `pvp_timer` и полем `welcome.pvpUntil`. Клиентский таймер считается от `serverNow`.

## Tests

`npx vitest run tests/chat-censor.test.ts tests/player-rules.test.ts tests/server/pvp-chat-teleport.test.ts tests/server/chat-channels.test.ts tests/server/anarchy-plugins.test.ts`

Плюс прежние `game-menu`, `clan-invites-announce`, `homes`, `duels-world`, `chat-layout`.

## Visual QA

Плашка `#pvp-badge` стоит над сердцами и хотбаром. Фон `rgba(18, 18, 20, 0.72)`, текст `#ffe14a`. Проверено в happy-dom: один и тот же элемент меняет текст и скрывается, кнопка «Спавн» не блокируется, жёлтое русское уведомление видно в корне меню. Полный WebGL-бой в браузере не запускался.

## Performance

Словари компилируются один раз. На сообщение — разбор токенов и поиск по множествам, без регулярного выражения на весь словарь.

## Audit

- Повторный телепорт часто упирался в старый английский таймер плагина (`Please wait …`). У спавна этот текст был внизу меню.
- Личные сообщения шли мимо `handleChat`. Теперь у них тот же кулдаун и цензура до записи.
- `/back`, `/tp` и телепорт клана не входили в общий кулдаун и в блокировку PvP.
- Срок PvP теперь дополнительно едет в личном `health.pvpUntil`.

## Known issues

- У РТП может остаться собственный кулдаун плагина длиннее 5 секунд. Текст отказа русский.
- «blow job» и «соси член» заменяются целиком как выражения.
- Полный vitest: 33 падения в визуальных и файловых тестах (Three, Pillow, MP3, броня, оверлеи добычи) и в `classic-combat-integration` на тестовом `InputManager` без `sneak`. Это не серверный путь PvP.

## Deferred

Снятие отдельного кулдауна плагина РТП, если общий срок должен быть единственным.

## Next work

Не деплоить и не вливать в `main`.

## Git

Ветка `cursor/restore-chat-pvp-teleport-rules`.
