import { describe, expect, it } from 'vitest';
import { formatCompactMegacoins } from '../shared/megacoins';
import { CLAN_ICON_GLYPH, CLAN_ICON_IDS, validateClanName } from '../shared/clans';
import {
  clanIconGlyph,
  clanIconHtml,
  clanJoinCaption,
  clanJoinDisabled,
  clanKillsHtml,
  clanRankHtml,
  clanRowLabel,
  clanSortButtonsHtml,
  keepClanSearchDraft,
  showsClanBack,
} from '../src/ui/clanGui';
import type { ServerClanMessage } from '../shared/protocol';

describe('clan GUI helpers', () => {
  it('keeps the search draft only while that input is focused', () => {
    const input = { id: 'search' } as HTMLInputElement;
    const other = { id: 'other' } as HTMLInputElement;
    expect(keepClanSearchDraft(input, input)).toBe(true);
    expect(keepClanSearchDraft(other, input)).toBe(false);
    expect(keepClanSearchDraft(null, input)).toBe(false);
  });

  it('renders trophy ranks for 1-3 and text after that', () => {
    expect(clanRankHtml(1)).toContain('mc-clan-rank-col');
    expect(clanRankHtml(1)).toContain('mc-clan-trophy-1');
    expect(clanRankHtml(1)).toContain('mc-clan-cup-emoji');
    expect(clanRankHtml(1)).toContain('🏆');
    expect(clanRankHtml(2)).toContain('mc-clan-trophy-2');
    expect(clanRankHtml(2)).toContain('🏆');
    expect(clanRankHtml(3)).toContain('mc-clan-trophy-3');
    expect(clanRankHtml(3)).toContain('🏆');
    expect(clanRankHtml(4)).toContain('mc-clan-rank-col');
    expect(clanRankHtml(4)).toContain('#4');
    expect(clanRankHtml(4)).not.toContain('🏆');
    expect(clanRankHtml(4)).not.toContain('mc-clan-trophy');
    expect(clanRankHtml(10)).toContain('#10');
    expect(clanRankHtml(100)).toContain('#100');
  });

  it('maps every clan icon id, including the emoji-presentation shield', () => {
    expect(CLAN_ICON_IDS).toHaveLength(10);
    expect(CLAN_ICON_GLYPH.shield).toContain('\u{1F6E1}');
    expect(CLAN_ICON_GLYPH.shield).toContain('\uFE0F');
    for (const id of CLAN_ICON_IDS) {
      expect(clanIconGlyph(id).length).toBeGreaterThan(0);
      expect(clanIconHtml(id)).toContain(clanIconGlyph(id));
      expect(clanIconHtml(id)).not.toContain('data-clan-icon');
    }
    expect(clanIconGlyph('shield')).toBe(CLAN_ICON_GLYPH.shield);
  });

  it('builds icon+name rows and join disabled states', () => {
    expect(clanRowLabel({ icon: 'swords', name: 'Warriors' })).toBe(`${clanIconGlyph('swords')} Warriors`);
    expect(CLAN_ICON_IDS).toHaveLength(10);
    const none: ServerClanMessage['card'] = {
      clanId: 'c',
      name: 'Warriors',
      icon: 'swords',
      totalBalance: 1000,
      totalLabel: '1К',
      memberCount: 1,
      ownerId: 'a',
      ownerName: 'Ada',
      isOwner: false,
      isMember: false,
      isFull: false,
      joinState: 'none',
    };
    expect(clanJoinDisabled(none)).toBe(false);
    expect(clanJoinCaption({ ...none, joinState: 'invited' })).toBe('Вступить в клан');
    expect(clanJoinDisabled({ ...none, joinState: 'invited' })).toBe(false);
    expect(clanJoinCaption({ ...none, joinState: 'sent' })).toBe('Заявка отправлена');
    expect(clanJoinCaption({ ...none, joinState: 'full' })).toBe('Клан заполнен');
    expect(clanJoinDisabled({ ...none, joinState: 'other-clan' })).toBe(true);
    expect(clanJoinDisabled({ ...none, joinState: 'own' })).toBe(true);
  });

  it('shows back on the clan card but not on ranking unless opened from the game menu', () => {
    expect(showsClanBack('card')).toBe(true);
    expect(showsClanBack('ranking')).toBe(false);
    expect(showsClanBack('create')).toBe(false);
    expect(showsClanBack('ranking', 'menu')).toBe(true);
    expect(showsClanBack('create', 'menu')).toBe(true);
    expect(showsClanBack('join-confirm')).toBe(true);
    expect(showsClanBack('member-card')).toBe(true);
    expect(showsClanBack('transfer-confirm')).toBe(true);
    expect(showsClanBack('accept')).toBe(true);
    expect(showsClanBack('announce')).toBe(true);
    expect(showsClanBack('accept', 'menu')).toBe(true);
  });

  it('renders money/kills sort toggles and a muted kills label', () => {
    expect(clanSortButtonsHtml('money', 'data-clan-member-sort')).toContain('is-on');
    expect(clanSortButtonsHtml('money', 'data-clan-member-sort')).toContain('По монетам');
    expect(clanSortButtonsHtml('money', 'data-clan-ranking-sort')).toContain('mc-clan-sort');
    expect(clanSortButtonsHtml('money', 'data-clan-ranking-sort')).not.toContain('mc-ah-actions');
    expect(clanSortButtonsHtml('kills', 'data-clan-ranking-sort')).toContain('data-clan-ranking-sort="kills"');
    expect(clanKillsHtml('🗡️ 2 340 Уб.')).toContain('mc-clan-kills');
    expect(clanKillsHtml('🗡️ 2 340 Уб.')).toContain('2 340');
  });

  it('formats compact balances for clan rows', () => {
    expect(formatCompactMegacoins(1200)).toBe('1.2К');
    expect(formatCompactMegacoins(1_200_000)).toBe('1.2М');
    expect(validateClanName('MegaClan').ok).toBe(true);
  });

  it('does not treat the owner row as a kick target via join helpers', () => {
    const own: ServerClanMessage['card'] = {
      clanId: 'c',
      name: 'Warriors',
      icon: 'swords',
      totalBalance: 10,
      totalLabel: '10',
      memberCount: 2,
      ownerId: 'a',
      ownerName: 'Ada',
      isOwner: true,
      isMember: true,
      isFull: false,
      joinState: 'own',
      selectedMemberId: 'b',
      canKickSelected: true,
    };
    expect(clanJoinDisabled(own)).toBe(true);
    expect(own.canKickSelected).toBe(true);
    expect({ ...own, selectedMemberId: 'a', canKickSelected: false }.canKickSelected).toBe(false);
  });
});

describe('clan overlay CSS contracts', () => {
  it('keeps sort toggles side-by-side with white selected text', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const gameUi = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');
    expect(css).toContain('.mc-clan-sort {');
    expect(css).toContain('grid-template-columns: 1fr 1fr');
    expect(css).toContain('.mc-ah-btn.is-on');
    expect(css).toMatch(/\.mc-ah-btn\.is-on[^{]*\{[^}]*color: #fff/);
    expect(css).not.toMatch(/\.mc-ah-btn\.is-on \{[^}]*color: #1a1a1a/);
    expect(css).toContain('.mc-clan-panel .mc-ah-btn.is-on');
    expect(css).toContain('#app.controls-suppressed #hud-corner');
    expect(css).toContain('#app.controls-suppressed #hud-corner button');
    expect(css).toContain('#app.controls-suppressed canvas');
    expect(css).toContain('#app.controls-suppressed #ui-root');
    expect(gameUi).toContain('resetOverlayModal');
    expect(gameUi).toContain('replaceWith');
    expect(gameUi).toContain('keepModal');
    expect(gameUi).toContain('bindOverlayPointerShield');
    expect(gameUi).toContain('closeSiblingOverlays');
    expect(gameUi).toContain('return this.inventoryContext !== undefined');
    expect(css).toContain('#e8a8a8');
    expect(css).toMatch(/\.mc-clan-role \{[^}]*color: #e8e8e8/);
    expect(css).not.toMatch(/\.mc-clan-role \{[^}]*color: #2f2f2f/);
    expect(css).toMatch(/\.mc-clan-owner \{[^}]*color: #d8d8d8/);
    expect(css).not.toMatch(/\.mc-clan-owner \{[^}]*color: #404040/);
    expect(gameUi).toContain("action: 'select_clan'");
    expect(gameUi).toContain("action: 'set_ranking_sort'");
    expect(gameUi).toContain("data-clan-action=\"open_announce\"");
    expect(gameUi).toContain("data-clan-action=\"send_announcement\"");
    expect(gameUi).toContain("data-clan-action=\"reject_invitation\"");
    expect(gameUi).toContain('Объявление соклановцам');
    expect(gameUi).toContain('Напишите объявление клану');
    expect(gameUi).toContain('data-clan-announce-text');
    expect(gameUi).toContain('data-clan-invitation-id');
    expect(gameUi).toContain('Принять');
    expect(gameUi).toContain('Отклонить');
    expect(gameUi).toContain("action: 'set_announce_text'");
    expect(css).toContain('.chat-line.style-announcement');
    expect(css).toContain('#4ecfdc');
    expect(css).not.toContain('🪙');
    expect(gameUi).not.toMatch(/type: 'clan_action',\s*action: 'money'/);
    expect(gameUi).not.toMatch(/type: 'clan_action',\s*action: 'kills'/);
    expect(gameUi).toContain('.mc-clan-icon-pick[data-clan-icon]');
    expect(gameUi).toContain('isClanActionKind');
    expect(gameUi).toContain("target.closest('[data-ui=\"close\"]')");
    expect(gameUi).toContain("target.closest('input, textarea, label')");
    expect(gameUi.indexOf("action: 'select_clan'")).toBeLessThan(gameUi.indexOf('.mc-clan-icon-pick[data-clan-icon]'));
    expect(gameUi).toContain('event.stopPropagation()');
    expect(gameUi).toContain('event.preventDefault();');
    const { CLAN_ACTIONS, MENU_ACTIONS } = await import('../shared/protocol');
    for (const action of new Set([...gameUi.matchAll(/type: 'clan_action',\s*action: '([a-z_]+)'/g)].map((match) => match[1]!))) {
      expect(CLAN_ACTIONS, action).toContain(action);
    }
    for (const action of new Set([...gameUi.matchAll(/type: 'menu_action',\s*action: '([a-z_]+)'/g)].map((match) => match[1]!))) {
      expect(MENU_ACTIONS, action).toContain(action);
    }
  });
});
