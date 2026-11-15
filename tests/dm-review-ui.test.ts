/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI';
import { menuDmReviewHtml } from '../src/ui/gameMenuGui';
import { menuLogicalHeight, menuLogicalWidth, menuUiScale } from '../src/ui/containerTheme';
import { showsMenuBack } from '../shared/gameMenu';
import { DIRECT_MESSAGE_REVIEW_EMPTY, formatDirectMessageStamp } from '../shared/directMessages';
import type { NetworkDmReviewMessage, ServerMenuMessage } from '../shared/protocol';

afterEach(() => {
  document.body.innerHTML = '';
});

function review(messages: readonly NetworkDmReviewMessage[]): ServerMenuMessage {
  return {
    type: 'menu',
    screen: 'dm-review',
    title: 'Личная переписка: PlayerOne ↔ PlayerTwo',
    dmReview: {
      leftName: 'PlayerOne',
      rightName: 'PlayerTwo',
      title: 'Личная переписка: PlayerOne ↔ PlayerTwo',
      messages,
    },
  };
}

describe('operator direct-message review window', () => {
  it('shows both speakers in order, scrolls to the end, and has no composer', () => {
    const early = Date.UTC(2026, 10, 12, 7, 4, 5);
    const late = early + 65_000;
    const state = review([
      { senderId: 'one', senderName: 'PlayerOne', text: 'старое <b>', createdAt: early },
      { senderId: 'two', senderName: 'PlayerTwo', text: 'новое', createdAt: late },
    ]);
    const html = menuDmReviewHtml(state, (value) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'));
    expect(html).toContain('Личная переписка: PlayerOne ↔ PlayerTwo');
    expect(html.indexOf('PlayerOne')).toBeLessThan(html.indexOf('PlayerTwo'));
    expect(html.indexOf('старое')).toBeLessThan(html.indexOf('новое'));
    expect(html).toContain(formatDirectMessageStamp(early));
    expect(html).toContain(formatDirectMessageStamp(late));
    expect(html).toContain('старое &lt;b&gt;');
    expect(html).not.toContain('data-friend-chat-input');
    expect(html).not.toContain('data-friend-chat-send');
    expect(showsMenuBack('dm-review')).toBe(false);

    const root = document.createElement('div');
    document.body.append(root);
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 480 });
    const ui = new GameUI(root);
    ui.openGameMenu(state, { send: () => undefined, close: () => undefined });
    const painted = root.querySelector<HTMLElement>('[data-dm-review-log]');
    expect(painted?.scrollTop).toBe(480);
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', previous);
    else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    expect(root.querySelector('[data-ui="close"]')).toBeInstanceOf(HTMLButtonElement);
    expect(root.querySelector('[data-friend-chat-input]')).toBeNull();
    expect(root.querySelector('.mc-menu-panel-chat')).toBeInstanceOf(HTMLElement);

    const empty = menuDmReviewHtml(review([]), (value) => value);
    expect(empty).toContain(DIRECT_MESSAGE_REVIEW_EMPTY);

    expect(menuLogicalHeight('dm-review')).toBe(268);
    expect(menuLogicalWidth('dm-review', 390)).toBe(menuLogicalWidth('friends', 390));
    expect(menuUiScale(390, 280, menuLogicalWidth('dm-review', 390), 268)).toBeGreaterThanOrEqual(1);
    expect(menuUiScale(1920, 1080, menuLogicalWidth('dm-review', 1920), 268)).toBeGreaterThanOrEqual(1);
  });
});
