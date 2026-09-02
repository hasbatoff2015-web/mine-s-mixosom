import { describe, expect, it } from 'vitest';
import gameSource from '../src/core/Game.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';

function sourceSection(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('UI visual pass on the authoritative main contracts', () => {
  it('keeps live online status and the existing server connect callbacks', () => {
    const onlineUi = sourceSection(gameUiSource, 'showOnlineServers(', 'showCreateWorld(');
    expect(onlineUi).toContain('live?: OnlineServerLiveStatus');
    expect(onlineUi).toContain('live.reachable');
    expect(onlineUi).toContain('actions.connect(selectedId)');
    expect(onlineUi).toContain("button.addEventListener('dblclick'");

    const onlineGame = sourceSection(gameSource, 'private async showOnlineServerList(', 'private async startOnlineAnarchy(');
    expect(onlineGame).toContain('fetchAnarchyStatus()');
    expect(onlineGame).toContain('this.ui.showOnlineServers(');
    expect(onlineGame).toContain('this.connectOnlineServer(id)');
  });

  it('keeps authoritative cursor and inventory action routing alongside Creative UI', () => {
    expect(gameUiSource).toContain('submitAction?: (message: ClientInventoryActionMessage) => void');
    expect(gameUiSource).toContain('applyAuthoritativeCursor(cursor: ItemStack | null');
    expect(gameUiSource).toContain("submitAction({ type: 'inventory_action', action: 'recipe'");
    expect(gameUiSource).toContain("submitAction({ type: 'inventory_action', action: 'click'");
    expect(gameUiSource).toContain('role="tablist" aria-label="Разделы творческого инвентаря"');
  });

  it('keeps chat/death/respawn and online no-local-simulation paths', () => {
    expect(gameUiSource).toContain('showDeath(onRespawn: () => void, onQuit: () => void)');
    expect(gameUiSource).toContain('openChat(prefix = \'\')');
    expect(gameUiSource).toContain('chatFocusToken');
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
