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
  it('shows Мегакрафт without the account route', () => {
    expect(gameUiSource).toContain('class="megacraft-logo" aria-label="Мегакрафт"');
    expect(gameUiSource).toContain('<span>МЕГАКРАФТ</span>');
    expect(gameUiSource).toContain('<h1>МЕГАКРАФТ</h1>');
    expect(gameUiSource).not.toContain('FRONTIER');
    expect(gameUiSource).not.toContain('Frontier');
    expect(gameUiSource).not.toContain('survival alpha');
    expect(gameUiSource).not.toContain('playable alpha');
    expect(gameUiSource).not.toContain('data-action="account"');
    expect(gameUiSource).not.toContain('showAccount(');
    expect(gameUiSource).not.toContain('frontier-logo');
    expect(gameUiSource).toContain('data-action="select-skin"');
    expect(gameUiSource).toContain('character-panel');
    expect(gameUiSource).toContain('id="online-nickname"');
    expect(gameUiSource).toContain('class="online-nickname-editor"');
    expect(gameSource).not.toContain('showAccount(');
    expect(gameSource).not.toContain('account:');
    expect(gameSource).toContain('selectSkin: () => this.showSkinSelector()');
    expect(gameSource).toContain('saveNickname: (raw) => {');
    expect(styleSource).toContain("url('/ui/frontier-menu-background.png')");
  });

  it('keeps live online status and the existing server connect callbacks', () => {
    const onlineUi = sourceSection(gameUiSource, 'showOnlineServers(', 'showCreateWorld(');
    expect(onlineUi).toContain('renderOnlineServerRows(statuses, current)');
    expect(onlineUi).toContain('actions.connect(current)');
    expect(onlineUi).not.toContain('пока недоступно');
    expect(onlineUi).not.toContain('menu-notice');
    expect(onlineUi).toContain("button.addEventListener('dblclick'");

    const onlineGame = sourceSection(gameSource, 'private async showOnlineServerList(', 'private async startOnlineAnarchy(');
    expect(onlineGame).toContain('fetchLocalServerStatuses()');
    expect(onlineGame).toContain('this.ui.showOnlineServers(');
    expect(onlineGame).toContain('this.connectOnlineServer(id)');
    expect(onlineGame).toContain('clientUrlForServer(id)');
    expect(onlineGame).toContain('isLocalServerName(id)');
    expect(onlineGame).toContain('loadPlayerNickname()');
    expect(onlineUi).toContain('bindOnlineNickname');
    const connect = sourceSection(gameSource, 'private async connectOnlineServer(', 'private async startOnlineAnarchy(');
    expect(connect).toContain('loadPlayerNickname()');
    expect(connect).not.toContain('online-nickname');
  });

  it('keeps Press Start on primary menu text and Inter on secondary captions', () => {
    expect(styleSource).toContain('.megacraft-logo');
    expect(styleSource).not.toContain('.frontier-logo');
    expect(styleSource).toMatch(/\.menu-screen \.game-button \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.world-copy strong,\s*\.server-copy strong \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.server-caption \{[^}]*font-family: var\(--font-ui\)/);
    expect(styleSource).toMatch(/:root \{[^}]*font-family: var\(--font-ui\)/);
    expect(styleSource).not.toMatch(/body \{[^}]*font-family: var\(--font-display\)/);
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
});
