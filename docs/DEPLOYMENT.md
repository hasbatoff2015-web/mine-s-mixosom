# Выкладка релиза

Три игровых процесса из `docs/SYSTEMD.md` читают код по ссылке `/opt/frontier-cubes/current`. Миры лежат отдельно и этой процедурой не изменяются.

| | Путь |
| --- | --- |
| Релиз | `/opt/frontier-cubes/releases/<release-id>/` |
| Текущий код | `/opt/frontier-cubes/current` → этот релиз |
| Предыдущий id | `/opt/frontier-cubes/previous` |
| Anarchy | `/var/lib/frontier-cubes/worlds/anarchy` |
| Survival | `/var/lib/frontier-cubes/worlds/survival` |
| Peaceful | `/var/lib/frontier-cubes/worlds/peaceful` |

В каталоге релиза только то, что нужно для `node dist/server/index.mjs`:

```text
dist/server/index.mjs
package.json
node_modules/ws/
RELEASE_ID
```

`build:server` оставляет `ws` внешним. Поэтому пакет копируется в релиз на машине сборки. На VPS `npm install` не запускается. `server/data` и `/var/lib/frontier-cubes` в релиз не входят.

Игровые unit-ы работают от пользователя `frontier-cubes`. Скрипт выкладки запускает администратор. После копирования релиз принадлежит root и доступен на чтение сервисному пользователю. Unit-файлы не меняются, поэтому `systemctl daemon-reload` при смене релиза не нужен.

## Первичная настройка

Каталоги, пользователь и unit-ы ставятся один раз по `docs/SYSTEMD.md`. После `enable --now` процессы ещё не найдут bundle, пока не появится `current`. Первый успешный deploy это исправляет.

## Сборка

На машине сборки, в репозитории, где уже есть `node_modules`:

```bash
npm ci
npm run build:server
npm run pack:release
```

Без аргументов каталог — `release/<id>/` в корне репозитория. Id — `git rev-parse --short=12 HEAD`. Повторный запуск того же id заменяет только этот локальный каталог. Timestamp в id не используется. Явный путь не перезаписывается:

```bash
npm run pack:release -- --out /tmp/fc-releases/228492d6607b --release-id 228492d6607b
tar -C /tmp/fc-releases -czf /tmp/fc-228492d6607b.tar.gz 228492d6607b
```

## Установка

На сервере, из checkout со скриптами:

```bash
sudo bash scripts/deploy-release.sh \
  --release-id 228492d6607b \
  --source /tmp/fc-228492d6607b.tar.gz
```

`--source` может быть каталогом или `.tar.gz`. Порядок внутри скрипта:

1. Проверить id и наличие `dist/server/index.mjs` и `node_modules/ws`.
2. Скопировать только эти файлы в `/opt/frontier-cubes/releases/<id>/`. Существующий id не перезаписывается.
3. Атомарно переключить ссылку: `ln -s <new> current.new`, затем `mv -Tf current.new current`.
4. `systemctl restart` трёх unit-ов: `frontier-cubes-anarchy.service`, `frontier-cubes-survival.service`, `frontier-cubes-peaceful.service`. Это SIGTERM: мир сохраняется, `.instance.lock` снимается.
5. Дождаться `scripts/check-game-servers.mjs` (то же, что `npm run status:servers`).

Успех только если все три ответа такие:

| Порт | mode | world | ready |
| --- | --- | --- | --- |
| 2567 | anarchy | anarchy | true |
| 2568 | survival | survival | true |
| 2569 | peaceful | peaceful | true |

Если bundle битый, restart не прошёл или хотя бы один `/status` не сошёлся, скрипт выходит с ненулевым кодом. Предыдущий релиз не удаляется. Если до этого был рабочий `current`, ссылка возвращается на него, сервисы перезапускаются и health-check выполняется ещё раз. Сообщение об ошибке всё равно остаётся ошибкой выкладки.

Повтор того же id не затирает уже установленный каталог.

## Откат

```bash
sudo bash scripts/rollback-release.sh
```

Скрипт читает `/opt/frontier-cubes/previous`, атомарно возвращает `current`, перезапускает те же три сервиса и снова проверяет `/status`. Каталоги миров не читает и не удаляет. Если после отката health-check не прошёл, `current` возвращается на релиз, который был до отката, и скрипт завершается с ненулевым кодом.

## Старые релизы

Автоматически ничего не удаляется. Просмотр:

```bash
bash scripts/cleanup-releases.sh
```

Удаление только лишних каталогов, не `current` и не previous:

```bash
sudo bash scripts/cleanup-releases.sh --apply
```

Пока не записаны оба id, cleanup ничего не удаляет. Каталог `/var/lib/frontier-cubes` он не принимает даже как `--root`.

## Журналы

```bash
journalctl -u frontier-cubes-anarchy -u frontier-cubes-survival -u frontier-cubes-peaceful -f
npm run status:servers
```

## Если выкладка не сошлась

- `invalid release id` — в id есть путь или пробел. Нужен SHA или другой один сегмент.
- `missing dist/server/index.mjs` — на машине сборки не был `npm run build:server`.
- `missing node_modules/ws` — pack запускали без установленных зависимостей.
- `release already exists` — этот id уже стоит. Соберите другой SHA.
- `health-check failed` — смотрите `journalctl` конкретного unit-а. Мир на диске остаётся прежним.
- `no previous release recorded` — откатывать ещё нечего, это первая успешная выкладка.
