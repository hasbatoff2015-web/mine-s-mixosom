# qaSideDebug empty inspect view

Дата: 2026-08-21  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

Починить `qaSideDebug=1`, который показывал только фон и overlay. Production generated topology/UV/winding/depth/pose не менять.

## Result

Root cause: `bindEntityLightReceiver` ставил `onBeforeRender`, который делал `material.userData.uEntityLight`. `qaSideDebug` назначал `material[]`; у массива нет `userData`, callback кидал TypeError внутри `renderer.render()`, предмет не рисовался.

Fix: QA-only `MeshBasicMaterial` тройка (textured front, dim back, vertex-colored sides) + сброс `onBeforeRender`. Inspect camera — orthographic. Entity-light callback теперь безопасен для material arrays.

## Git

Commit/push не выполнялись.
