# Закрытие таблички и книги

Дата: 2026-10-15

## Goal

Редактор таблички и книга должны закрываться и возвращать управление игре.

## Result

Кнопки «Закрыть» и «Готово», а также Escape, снимают свой оверлей. Инвентарь при этом не трогается. Чужое более новое окно не удаляется.

## Root cause

`openSign` и `openBook` вешали закрытие на `closeInventory(false)`. Редактор не является инвентарём: `inventoryContext` пуст, и `closeInventory` сразу выходит. Узел `.sign-backdrop` остаётся в DOM, `this.modal` на него указывает, `isBlockingOverlay()` остаётся истинным. `enterPlaying()` возвращает состояние PLAYING, но окно на экране остаётся.

## Fix

Закрытие проверяет, что этот редактор всё ещё владеет `this.modal`. Если да, вызывается `releaseOverlay()` и `onClose` ровно один раз. Если поверх уже другое окно, снимается только старый узел.

## Tests

`tests/sign-book-modal.test.ts` в happy-dom жмёт настоящие кнопки и Escape. SIGN-1 и BOOK-1 на старом `closeInventory` падают: оверлей остаётся. После исправления набор проходит.

## Visual QA

На DEV не проверялось.

## Known issues

Нет.

## Deferred

Серверная запись таблички не менялась.

## Git

Отдельный коммит на ветке `cursor/admin-antidupe-postgres-foundation-26a8`.
