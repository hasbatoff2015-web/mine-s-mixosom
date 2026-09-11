import { describe, expect, it } from 'vitest';
import { formatCompactMegacoins } from '../shared/megacoins';
import { CLAN_ICON_GLYPH, CLAN_ICON_IDS, validateClanName } from '../shared/clans';
import {
  clanIconGlyph,
  clanIconHtml,
  clanJoinCaption,
  clanJoinDisabled,
  clanRankHtml,
  clanRowLabel,
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
      expect(clanIconHtml(id)).toContain(`data-clan-icon="${id}"`);
      expect(clanIconHtml(id)).toContain(clanIconGlyph(id));
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

  it('shows back on the clan card but not on ranking', () => {
    expect(showsClanBack('card')).toBe(true);
    expect(showsClanBack('ranking')).toBe(false);
    expect(showsClanBack('create')).toBe(false);
    expect(showsClanBack('join-confirm')).toBe(true);
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
