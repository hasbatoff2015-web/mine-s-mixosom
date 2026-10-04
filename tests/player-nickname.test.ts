import { describe, expect, it } from 'vitest';
import { MAX_PLAYER_NAME_LENGTH, MIN_PLAYER_NAME_LENGTH } from '../shared/config';
import { PLAYER_NICKNAME_PATTERN, playerNicknameError, sanitizePlayerName } from '../shared/playerName';
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

  it('rejects empty, spaced, cyrillic, and symbol nicks without trimming them into valid ones', () => {
    const lengthMessage = 'Ник должен содержать от 2 до 20 символов.';
    const charsetMessage = 'Только английские буквы и цифры.';
    expect(PLAYER_NICKNAME_PATTERN.source).toBe('^[A-Za-z0-9]+$');
    expect(sanitizePlayerName('')).toBeUndefined();
    expect(sanitizePlayerName('A')).toBeUndefined();
    expect(sanitizePlayerName('  ')).toBeUndefined();
    expect(sanitizePlayerName(' Misha')).toBeUndefined();
    expect(sanitizePlayerName('Misha ')).toBeUndefined();
    expect(sanitizePlayerName('Mi sha')).toBeUndefined();
    expect(sanitizePlayerName('Миша')).toBeUndefined();
    expect(sanitizePlayerName('Custom_Nick')).toBeUndefined();
    expect(sanitizePlayerName('Custom-Nick')).toBeUndefined();
    expect(sanitizePlayerName('Mi\nsha')).toBeUndefined();
    expect(sanitizePlayerName('Mi\tsha')).toBeUndefined();
    expect(playerNicknameError('')).toBe(lengthMessage);
    expect(playerNicknameError('A')).toBe(lengthMessage);
    expect(playerNicknameError('a'.repeat(21))).toBe(lengthMessage);
    expect(playerNicknameError('Mi sha')).toBe(charsetMessage);
    expect(playerNicknameError('Миша')).toBe(charsetMessage);
    expect(playerNicknameError('Custom_Nick')).toBe(charsetMessage);
    expect(playerNicknameError('Custom-Nick')).toBe(charsetMessage);
  });

  it('accepts 2 to 20 latin letters and digits and rejects 21', () => {
    expect(MIN_PLAYER_NAME_LENGTH).toBe(2);
    expect(MAX_PLAYER_NAME_LENGTH).toBe(20);
    for (const name of ['Ab', 'Misha', 'Player123', 'A1', 'a'.repeat(20), '12345678901234567890']) {
      expect(sanitizePlayerName(name)).toBe(name);
      expect(playerNicknameError(name)).toBeUndefined();
      expect(savePlayerNickname(name, memoryStorage())).toEqual({ ok: true, name });
    }
    const max = 'a'.repeat(20);
    const tooLong = 'a'.repeat(21);
    expect(sanitizePlayerName(tooLong)).toBeUndefined();
    expect(playerNicknameError(tooLong)).toBe('Ник должен содержать от 2 до 20 символов.');
    expect(savePlayerNickname(tooLong, memoryStorage()).ok).toBe(false);
    expect(buildAnarchyJoinMessage(tooLong)).toEqual({
      type: 'join',
      protocol: PROTOCOL_VERSION,
    });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: tooLong,
    })).not.toHaveProperty('name');
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: max,
    })).toMatchObject({ type: 'join', name: max });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'Миша',
    })).not.toHaveProperty('name');
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: ' Misha',
    })).not.toHaveProperty('name');
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

  it('wires a free-typed online nickname field, not a suggestion-only picker', () => {
    expect(gameUiSource).toContain('id="online-nickname"');
    expect(gameUiSource).not.toContain('id="account-nickname"');
    expect(gameUiSource).toContain('type="text"');
    expect(gameUiSource).toContain('autocomplete="off"');
    expect(gameUiSource).not.toContain('autocomplete="nickname"');
    expect(gameUiSource).not.toMatch(/<select[^>]*nickname/);
    expect(gameUiSource).not.toContain('<datalist');
    expect(gameUiSource).toContain('input.value');
    expect(gameUiSource).toContain('maxlength="${MAX_PLAYER_NAME_LENGTH}"');
    expect(gameUiSource).toContain('minlength="${MIN_PLAYER_NAME_LENGTH}"');
    expect(gameSource).toContain('loadPlayerNickname()');
    expect(gameSource).toContain("client.connect(url, loadPlayerNickname(), this.playerAppearance)");
  });

  it('persists an arbitrary valid custom nick and ignores a stored legacy nick', () => {
    const storage = memoryStorage();
    expect(savePlayerNickname('Player123', storage)).toEqual({ ok: true, name: 'Player123' });
    expect(storage.data[PLAYER_NICKNAME_STORAGE_KEY]).toBe('Player123');
    expect(loadPlayerNickname(storage)).toBe('Player123');
    expect(PLAYER_NICKNAME_STORAGE_KEY).toBe('fc.player.nickname');
    const legacy = memoryStorage({ [PLAYER_NICKNAME_STORAGE_KEY]: 'Custom_Nick-2' });
    expect(loadPlayerNickname(legacy)).toBeUndefined();
    expect(legacy.data[PLAYER_NICKNAME_STORAGE_KEY]).toBe('Custom_Nick-2');
    expect(savePlayerNickname('Custom_Nick-2', memoryStorage()).ok).toBe(false);
  });
});
