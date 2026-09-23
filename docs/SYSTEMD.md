# systemd: три игровых процесса

Один и тот же production bundle, три независимых процесса. У каждого свой порт и свой каталог мира. Игровая механика, протокол и клиент здесь не меняются.

Код релиза и файлы миров лежат в разных местах. Обновление bundle не трогает миры.

| | Путь |
| --- | --- |
| Текущий релиз | `/opt/frontier-cubes/current` → `/opt/frontier-cubes/releases/<sha>` |
| Мир Anarchy | `/var/lib/frontier-cubes/worlds/anarchy` |
| Мир Survival | `/var/lib/frontier-cubes/worlds/survival` |
| Мир Peaceful | `/var/lib/frontier-cubes/worlds/peaceful` |
| Пустые дисковые плагины | `/var/lib/frontier-cubes/plugins` |
| Env | `/etc/frontier-cubes/anarchy.env`, `survival.env`, `peaceful.env` |
| Unit-файлы в репозитории | `deploy/systemd/` |

`WORLD_PATH` в env — это родитель `/var/lib/frontier-cubes/worlds`. Процесс сам дописывает `WORLD`, поэтому каталог мира получается `/var/lib/frontier-cubes/worlds/anarchy`, а не `.../anarchy/anarchy`. Так устроен `loadServerConfig`.

Процесс слушает `0.0.0.0`. Firewall, Nginx и TLS в этот шаг не входят.

Нужен Node.js 20+ и `node` по пути `/usr/bin/node`. Проверка: `command -v node`.

## Пользователь и каталоги

Игровой процесс не запускается от root.

```bash
sudo useradd --system --home /var/lib/frontier-cubes --shell /usr/sbin/nologin --user-group frontier-cubes
sudo mkdir -p /opt/frontier-cubes/releases \
  /var/lib/frontier-cubes/worlds/anarchy \
  /var/lib/frontier-cubes/worlds/survival \
  /var/lib/frontier-cubes/worlds/peaceful \
  /var/lib/frontier-cubes/plugins \
  /etc/frontier-cubes
sudo chown -R frontier-cubes:frontier-cubes /var/lib/frontier-cubes
sudo chmod 750 /var/lib/frontier-cubes /var/lib/frontier-cubes/worlds \
  /var/lib/frontier-cubes/worlds/anarchy \
  /var/lib/frontier-cubes/worlds/survival \
  /var/lib/frontier-cubes/worlds/peaceful
```

`/opt/frontier-cubes` остаётся читаемым для `frontier-cubes` и не должен быть местом, куда процесс пишет мир. Каталоги миров принадлежат `frontier-cubes` и имеют режим `750`: другой пользователь системы не может их менять. Файлы релиза после `deploy-release.sh` от root принадлежат root и открыты на чтение сервисному пользователю. В unit-файлах секретов нет.

## Установка релиза

Сборка и выкладка описаны в `docs/DEPLOYMENT.md`. Коротко: `npm run build:server`, `npm run pack:release`, затем на сервере `scripts/deploy-release.sh`. Каталоги миров этот шаг не изменяет. `npm install` на VPS не нужен: в релиз уже входит `dist/server/index.mjs` и external-пакет `ws`.

## Unit-файлы и env

```bash
sudo cp deploy/systemd/anarchy.env /etc/frontier-cubes/anarchy.env
sudo cp deploy/systemd/survival.env /etc/frontier-cubes/survival.env
sudo cp deploy/systemd/peaceful.env /etc/frontier-cubes/peaceful.env
sudo cp deploy/systemd/frontier-cubes-anarchy.service /etc/systemd/system/
sudo cp deploy/systemd/frontier-cubes-survival.service /etc/systemd/system/
sudo cp deploy/systemd/frontier-cubes-peaceful.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
```

`enable` без `--now`. Пока нет `/opt/frontier-cubes/current`, `start` падает, а `Restart=on-failure` поднимает unit снова через 5 секунд. Первый запуск делает `scripts/deploy-release.sh`: он переключает `current` и сам вызывает `systemctl restart`. `daemon-reload` после смены релиза не нужен.

В git лежат только эти значения: режим, порт, `HOST=0.0.0.0`, родитель миров, tick rate, view radius, max players, интервал сохранения, каталог дисковых плагинов. Паролей там нет. Если на сервере позже появится `FC_OPERATORS`, его дописывают в `/etc/frontier-cubes/*.env` и не коммитят.

Каждый unit:

- `User=frontier-cubes`
- `ExecStart=/usr/bin/node /opt/frontier-cubes/current/dist/server/index.mjs`
- `Restart=on-failure`, `RestartSec=5`
- `KillSignal=SIGTERM`, `TimeoutStopSec=30`
- `NoNewPrivileges=true`, `PrivateTmp=true`
- stdout/stderr в journald

`systemctl stop` шлёт SIGTERM. Процесс сохраняет мир, снимает `.instance.lock` и выходит с кодом 0, поэтому `Restart=on-failure` его снова не поднимает. Падение с кодом 1 (`listen`, `uncaughtException`, `unhandledRejection`, ошибка shutdown) поднимается через 5 секунд. Если `TimeoutStopSec` всё же убивает процесс, следующий старт видит мёртвый pid в `.instance.lock`, пишет `world lock stale` и забирает каталог. Живой pid тот же каталог не отдаёт.

## Статус и журналы

```bash
systemctl status frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
journalctl -u frontier-cubes-anarchy -u frontier-cubes-survival -u frontier-cubes-peaceful -f
```

Health check с той же машины:

```bash
curl -fsS http://127.0.0.1:2567/status
curl -fsS http://127.0.0.1:2568/status
curl -fsS http://127.0.0.1:2569/status
```

или из корня репозитория, если три процесса уже слушают порты:

```bash
npm run status:servers
```

Ожидание для каждого: HTTP 200, `ready: true`, `mode` и `world` равны `anarchy`, `survival` или `peaceful` на портах 2567, 2568 и 2569. `systemctl status` показывает, что процесс принадлежит unit-у `frontier-cubes-*` и пользователю `frontier-cubes`.

## Остановка и перезапуск

```bash
sudo systemctl stop frontier-cubes-anarchy
sudo systemctl start frontier-cubes-anarchy
sudo systemctl restart frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
```

`restart` для каждого сервиса шлёт SIGTERM, ждёт до 30 секунд, пока `stop()` сохранит мир и удалит `.instance.lock`, затем запускает процесс заново. После этого снова `npm run status:servers`.

## Обновление и откат

Новый релиз ставится через `scripts/deploy-release.sh`: каталог создаётся рядом со старым, `current` переключается атомарно, три сервиса получают SIGTERM и проходят `/status`. Предыдущий релиз не удаляется. Откат: `scripts/rollback-release.sh`. Подробности и очистка старых каталогов: `docs/DEPLOYMENT.md`. `daemon-reload` нужен только после смены unit-файлов, не после смены релиза.
