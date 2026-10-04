import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import gameSource from '../src/core/Game.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';

const styleSource = readFileSync('src/style.css', 'utf8');

function sourceSection(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('UI visual pass on the authoritative main contracts', () => {
  it('shows Мегакрафт on the main menu without an account route', () => {
    const main = sourceSection(gameUiSource, 'showMainMenu(', 'showSkinSelector(');
    expect(main).toContain('class="megacraft-logo"');
    expect(main).toContain('>МЕГАКРАФТ<');
    expect(main).toContain('aria-label="Мегакрафт"');
    expect(main).not.toContain('FRONTIER');
    expect(main).not.toContain('Frontier');
    expect(main).not.toContain('survival alpha');
    expect(main).not.toContain('playable alpha');
    expect(main).not.toContain('data-action="account"');
    expect(main).not.toContain('main-menu-footer');
    expect(main).toContain('data-action="select-skin"');
    expect(main).toContain('character-panel');
    expect(gameUiSource).not.toContain('showAccount(');
    expect(gameUiSource).not.toContain('AccountMenuActions');
    expect(gameSource).not.toContain('showAccount(');
    expect(gameSource).not.toContain('account:');
    expect(gameSource).toContain('selectSkin: () => this.showSkinSelector()');
    const loading = sourceSection(gameUiSource, 'showLoading(', 'updateWorldLoading(');
    expect(loading).toContain('>МЕГАКРАФТ<');
    expect(loading).not.toContain('FRONTIER');
    expect(loading).not.toContain('survival alpha');
  });

  it('keeps live online status and the existing server connect callbacks', () => {
    const onlineUi = sourceSection(gameUiSource, 'showOnlineServers(', 'showCreateWorld(');
    expect(onlineUi).toContain('renderOnlineServerRows(statuses, current)');
    expect(onlineUi).toContain('actions.connect(current)');
    expect(onlineUi).not.toContain('пока недоступно');
    expect(onlineUi).not.toContain('menu-notice');
    expect(onlineUi).toContain("button.addEventListener('dblclick'");
    expect(onlineUi).toContain('class="online-nickname-editor"');
    expect(onlineUi).toContain('bindOnlineNickname(actions, currentNickname)');
    expect(gameUiSource).toContain('actions.saveNickname(draft)');

    const onlineGame = sourceSection(gameSource, 'private async showOnlineServerList(', 'private async startOnlineAnarchy(');
    expect(onlineGame).toContain('saveNickname:');
    expect(onlineGame).toContain('loadPlayerNickname()');
    expect(onlineGame).toContain('Ник сохранён. Он будет использован при подключении к серверу.');
    expect(onlineGame).toContain('fetchLocalServerStatuses()');
    expect(onlineGame).toContain('this.ui.showOnlineServers(');
    expect(onlineGame).toContain('this.connectOnlineServer(id)');
    expect(onlineGame).toContain('clientUrlForServer(id)');
    expect(onlineGame).toContain('isLocalServerName(id)');
  });

  it('keeps authoritative cursor and inventory action routing alongside Creative UI', () => {
    expect(gameUiSource).toContain('submitAction?: (message: ClientInventoryActionMessage) => void');
    expect(gameUiSource).toContain('applyAuthoritativeCursor(cursor: ItemStack | null');
    expect(gameUiSource).toContain("submitAction({ type: 'inventory_action', action: 'recipe'");
    expect(gameUiSource).toContain("submitAction({ type: 'inventory_action', action: 'craft_recipe'");
    expect(gameUiSource).toContain("submitAction({ type: 'inventory_action', action: 'click'");
    expect(gameUiSource).toContain('role="tablist" aria-label="Разделы творческого инвентаря"');
  });

  it('keeps chat/death/respawn and online no-local-simulation paths', () => {
    expect(gameUiSource).toContain('showDeath(onRespawn: () => void, onQuit: () => void)');
    expect(gameUiSource).toContain('openChat(prefix = \'\')');
    expect(gameUiSource).toContain('chatFocusToken');
    expect(gameUiSource).toContain('scheduleScrollChatToBottom(token)');
    expect(gameUiSource).toContain('revealChatLines()');
    const onlineTick = sourceSection(gameSource, 'private tickOnline(', 'private tick():');
    expect(onlineTick).toContain("type: 'input'");
    expect(onlineTick).not.toContain('session.world.tick()');
    expect(gameSource).toContain('shouldRestoreGameplayAfterRespawn(');
    expect(gameSource).toContain('applyAuthoritativeCursor(');
  });

  it('keeps breaking and player presentation on the render path', () => {
    const render = sourceSection(gameSource, 'private render(alpha:', 'private updatePlayerPresentation(');
    expect(render).toContain('this.updatePlayerPresentation(session, position, now)');
    expect(render).toContain('this.updateBreakingOverlay()');
    expect(gameSource).toContain('nextCameraPerspective(this.cameraPerspective)');
  });

  it('scopes the pixel font to menu chrome and leaves secondary captions on the UI font', () => {
    expect(styleSource).toContain('.megacraft-logo');
    expect(styleSource).not.toContain('.frontier-logo');
    expect(styleSource).toMatch(/\.megacraft-logo span \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.menu-screen \.game-button \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.server-copy strong \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.server-caption \{[^}]*font-family: var\(--font-ui\)/);
    expect(styleSource).toMatch(/\.online-nickname-message \{[^}]*font-family: var\(--font-ui\)/);
    expect(styleSource).not.toMatch(/:root \{[^}]*font-family:\s*var\(--font-display\)/);
    expect(gameUiSource).not.toContain('frontier-logo');
    expect(styleSource).toContain("url('/ui/frontier-menu-background.png')");
  });
});
