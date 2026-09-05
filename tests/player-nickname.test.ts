import { describe, expect, it } from 'vitest';
import { MAX_PLAYER_NAME_LENGTH } from '../shared/config';
import { playerNicknameError, sanitizePlayerName } from '../shared/playerName';
import { parseClientMessage } from '../shared/protocol';
import { PROTOCOL_VERSION } from '../shared/config';
import { buildAnarchyJoinMessage } from '../src/net/AnarchyClient';
import {
  PLAYER_NICKNAME_STORAGE_KEY,
  loadPlayerNickname,
  savePlayerNickname,
  type NicknameStorage,
} from '../src/net/playerNickname';
import gameSource from '../src/core/Game.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';

function memoryStorage(initial: Record<string, string> = {}): NicknameStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

describe('player display nickname', () => {
  it('persists a valid nick in local storage', () => {
    const storage = memoryStorage();
    expect(loadPlayerNickname(storage)).toBeUndefined();
    const saved = savePlayerNickname('Misha', storage);
    expect(saved).toEqual({ ok: true, name: 'Misha' });
    expect(storage.data[PLAYER_NICKNAME_STORAGE_KEY]).toBe('Misha');
    expect(loadPlayerNickname(storage)).toBe('Misha');
  });

  it('rejects empty, spaced, and control-character nicks', () => {
    expect(sanitizePlayerName('')).toBeUndefined();
    expect(sanitizePlayerName('  ')).toBeUndefined();
    expect(sanitizePlayerName('Mi sha')).toBeUndefined();
    expect(sanitizePlayerName('Mi\nsha')).toBeUndefined();
    expect(sanitizePlayerName('Mi\tsha')).toBeUndefined();
    expect(playerNicknameError('')).toMatch(/пустым/);
    expect(playerNicknameError('Mi sha')).toMatch(/Пробелы/);
    expect(playerNicknameError('a'.repeat(MAX_PLAYER_NAME_LENGTH + 1))).toMatch(/длиннее/);
  });

  it('puts a valid nick on the join payload and omits an unset nick', () => {
    expect(buildAnarchyJoinMessage('Misha')).toEqual({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'Misha',
    });
    expect(buildAnarchyJoinMessage()).toEqual({
      type: 'join',
      protocol: PROTOCOL_VERSION,
    });
    expect(buildAnarchyJoinMessage('bad nick')).toEqual({
      type: 'join',
      protocol: PROTOCOL_VERSION,
    });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'Misha',
    })).toMatchObject({ type: 'join', name: 'Misha' });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'bad nick',
    })).toMatchObject({ type: 'join' });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'bad nick',
    })).not.toHaveProperty('name');
  });

  it('wires a free-typed Account nickname input, not a suggestion-only picker', () => {
    expect(gameUiSource).toContain('id="account-nickname"');
    expect(gameUiSource).toContain('type="text"');
    expect(gameUiSource).toContain('autocomplete="off"');
    expect(gameUiSource).not.toContain('autocomplete="nickname"');
    expect(gameUiSource).not.toMatch(/<select[^>]*nickname/);
    expect(gameUiSource).not.toContain('<datalist');
    expect(gameUiSource).toContain('nicknameInput?.value');
  });

  it('persists an arbitrary valid custom nick and reloads it', () => {
    const storage = memoryStorage();
    expect(savePlayerNickname('Custom_Nick-2', storage)).toEqual({ ok: true, name: 'Custom_Nick-2' });
    expect(storage.data[PLAYER_NICKNAME_STORAGE_KEY]).toBe('Custom_Nick-2');
    expect(loadPlayerNickname(storage)).toBe('Custom_Nick-2');
  });
});
