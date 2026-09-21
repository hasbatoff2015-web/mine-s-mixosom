# 2026-09-21 — Online menu for three local servers

## Goal

Make «Играть онлайн» list the three servers that already run on this branch. Do not change the server architecture. Do not merge PR #101.

## Result

The screen shows Anarchy, Survival, and Peaceful. The old notice that Survival is unavailable is gone. Each card uses `LOCAL_SERVER_PRESETS` for its WebSocket and `/status`. `?server=` preselects a card. **Подключиться** opens the selected card. `?anarchyUrl=`, `?anarchyHost=`, and `?anarchyPort=` still override only the card the page query addresses.

## Browser

With all three servers up, `?server=peaceful` selected Peaceful and showed `0 / 300` on every card. Choosing Survival from that page connected to `ws://127.0.0.1:2568`. A page without a query selected Anarchy and connected to `:2567`; Peaceful connected to `:2569`. After Survival was stopped, only that card showed «оффлайн». Anarchy and Peaceful stayed `0 / 300`. Survival was started again.
