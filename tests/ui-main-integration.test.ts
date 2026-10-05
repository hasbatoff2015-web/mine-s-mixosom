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
    expect(main).toContain('class="megacraft-logo__title">МЕГАКРАФТ<');
    expect(main).toContain('class="megacraft-logo__subtitle">ОНЛАЙН<');
    expect(main).toContain('aria-label="Мегакрафт Онлайн"');
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
    expect(loading).toContain('class="brand-subtitle">ОНЛАЙН<');
    expect(loading).toContain('brand--megacraft');
    expect(loading).not.toContain('FRONTIER');
    expect(loading).not.toContain('survival alpha');
    expect(loading).not.toContain('brand-mark');
    expect(loading).toContain('data-loading-percent');
    expect(loading).toContain('data-loading-detail');
    expect(gameUiSource).not.toContain('brand-mark');
    expect(gameSource).toContain("this.ui.showLoading('Загрузка мира', this.lastLoadPercent)");
    expect(gameSource).not.toContain('Подготовка мира…');
    expect(gameSource).toContain("this.ui.showLoading('Подключение к серверу…', 12, endpointLabel(url))");
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
    expect(styleSource).toMatch(/\.megacraft-logo__title \{[^}]*font-size: clamp\(64px, 7\.8vw, 128px\)/);
    expect(styleSource).toMatch(/\.megacraft-logo__subtitle \{[^}]*font-size: clamp\(26px, 3\.2vw, 46px\)/);
    expect(styleSource).toMatch(/\.megacraft-logo__subtitle \{[^}]*color: #d2dc62/);
    expect(styleSource).toMatch(/\.main-menu-center \{[^}]*width: min\(1180px, calc\(100vw - 48px\)\)/);
    expect(styleSource).toMatch(/\.main-menu-screen \.main-menu-actions \.game-button \{[^}]*min-height: 70px/);
    expect(styleSource).toMatch(/\.character-preview-canvas \{[^}]*height: clamp\(340px, 38vh, 420px\)/);
    expect(styleSource).toMatch(/\.menu-screen \.game-button \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.server-copy strong \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.server-caption \{[^}]*font-family: var\(--font-ui\)/);
    expect(styleSource).toMatch(/\.online-nickname-message \{[^}]*font-family: var\(--font-ui\)/);
    expect(styleSource).not.toMatch(/:root \{[^}]*font-family:\s*var\(--font-display\)/);
    expect(gameUiSource).not.toContain('frontier-logo');
    expect(styleSource).toContain("url('/ui/frontier-menu-background.png')");
    expect(styleSource).not.toContain('grid-template-rows: 1fr auto 1fr');
    expect(styleSource).toMatch(/\.main-menu-layout \{[^}]*grid-template-rows: auto auto/);
    expect(styleSource).toMatch(/\.main-menu-layout \{[^}]*align-content: center/);
    expect(styleSource).toContain('--menu-fit: 0.65');
    expect(styleSource).toContain('--menu-fit: 0.55');
    expect(styleSource).not.toMatch(/--menu-fit:\s*0\.50?\b/);
    expect(styleSource).not.toMatch(/--menu-fit:\s*0\.42\b/);
    expect(styleSource.match(/zoom: var\(--menu-fit\)/g)).toHaveLength(1);
    expect(styleSource).not.toContain('transform: scale');
    expect(styleSource).toMatch(/\.skin-selector-window \.skin-card-grid \{[^}]*max-height: none/);
    expect(styleSource).toMatch(/\.skin-selector-window \.skin-selector-preview \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/);
    expect(styleSource).toMatch(/\.skin-selector-window \.character-preview-canvas\.large \{[^}]*height: 100%/);
    expect(gameUiSource).toContain('data-action="cancel"');
    expect(gameUiSource).toContain('data-action="confirm"');
    expect(styleSource).not.toContain('.brand-mark');
    expect(styleSource).toMatch(/#loading-screen \.brand h1 \{[^}]*font-size: clamp\(34px, 4\.8vw, 46px\)/);
    expect(styleSource).toMatch(/#loading-screen \.brand-subtitle \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/#loading-screen \.brand-subtitle \{[^}]*color: #d2dc62/);
    expect(styleSource).toMatch(/\.setting-row > span strong \{[^}]*font-family: var\(--font-display\)/);
    expect(styleSource).toMatch(/\.setting-row > span strong \{[^}]*font-size: 11px/);
  });
});
