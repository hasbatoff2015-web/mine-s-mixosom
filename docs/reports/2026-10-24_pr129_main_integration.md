# Стыковка origin/main с PR #129

Дата: 2026-10-24. Слияние сделано в ветку антидюпа. В `main` этот PR не вливался.

## Git

- `origin/main` до и после: `c8da9fcbe86f63ee0102c5ee621718431dfe2f73`
- feature до: `906c4c8d8abd39a71a19ca4bb8f5caa53505d5ec`
- база: `2dd09ee7e555896b652789408b4ae93a094cef3b`
- операция: `git merge --no-ff origin/main`
- rebase и force push не делались

## Что взято с обеих сторон

С main: ранги VIP/PREMIUM/BOSS/TITAN, киты, косметические пчёлы и мини-крипер, эмоции, скины, зритель, меню, черновик Яндекса, статусы серверов, вода и автошахта.

С feature: UUID игрока и `sessionToken`, ревизия инвентаря, PostgreSQL-экономика, квитанции Stage 2C, аукцион с Promise, уникальные предметы, учёт ресурсов, OP только по UUID, админка двух равных администраторов, бэкапы, реестр Stage B. Вход Яндекса остаётся выключенным.

Ник из `FC_OPERATORS` по-прежнему не даёт OP. Донат-команда сначала находит игрока и пишет ранг на его UUID. Два игрока с одним ником не делят ранг. Старые донат-записи по нику сами на UUID не переносятся.

`/kit` вызывает `PlayerView.give`, а тот — `grantItems`. Алмазы кита пишутся в учёт как один минт. God Sword получает новый `itemInstanceId`. Стартовый набор пустой; `/kit start` выдаётся один раз.

Аукцион сохранил `AuctionResult | Promise<AuctionResult>`, ожидание сохранения и снимок инвентаря. Лимит лотов берётся из ранга.

## Текстовые конфликты

`WorldInstance`, `AnarchyClient`, `Game`, `permissions`, `auction`, `clan`, `buyer`, `config`, сохранения, плагины claims/home/tpa/economy и документы. Ни один важный файл не взят целиком с одной стороны.

## Проверки

PostgreSQL: NOT RUN. `FC_TEST_DATABASE_URL` не задан, локального сервера нет.

`npm run skins:check`, `typecheck`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `build`, `build:server`, `build:admin`, `smoke:server:prod` прошли.

`typecheck:sim` падает на DOM и `virtual:player-skin-content-hashes` в файлах, которые этот проход не чинил.

Полный Vitest после стыковки нужно читать по последнему прогону в отчёте агента. Ручной DEV не проверялся. В прод это не готово.
