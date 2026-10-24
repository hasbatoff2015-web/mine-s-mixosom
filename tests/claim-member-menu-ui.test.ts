/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI';
import { parseClientMessage, type ServerMenuMessage } from '../shared/protocol';

const sessions: GameUI[] = [];

afterEach(() => {
  sessions.splice(0);
  document.body.replaceChildren();
});

function open(members: ServerMenuMessage['claimMembers']): unknown[] {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  sessions.push(ui);
  const sent: unknown[] = [];
  ui.openGameMenu({
    type: 'menu',
    screen: 'claim-settings',
    title: 'Приват',
    claimMembers: members,
  }, {
    send: (message) => sent.push(message),
    close: () => undefined,
  });
  return sent;
}

describe('claim member remove button', () => {
  it('sends the full player id from the shared menu click handler', () => {
    const playerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const root = document.body;
    const sent = open([{ playerId, name: 'Steve' }]);
    expect(root.textContent).toContain('Steve');
    expect(root.textContent).not.toContain(playerId);
    const button = root.querySelector<HTMLButtonElement>('[data-menu-claim-kick]');
    expect(button?.dataset.menuClaimKick).toBe(playerId);
    button?.click();
    const parsed = parseClientMessage(sent[0]);
    expect(parsed).toMatchObject({
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId,
    });
    expect(parsed).not.toHaveProperty('name');
    if (parsed && 'playerId' in parsed) expect(parsed.playerId).toHaveLength(36);
  });

  it('does not offer removal for a legacy member that has no player id', () => {
    const root = document.body;
    open([{ name: 'OldNick' }]);
    expect(root.textContent).toContain('OldNick');
    expect(root.textContent).toContain('Старая запись, нужна миграция');
    expect(root.querySelector('[data-menu-claim-kick]')).toBeNull();
  });
});
