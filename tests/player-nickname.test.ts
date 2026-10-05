import { describe, expect, it } from 'vitest';
import { MAX_PLAYER_NAME_LENGTH, MIN_PLAYER_NAME_LENGTH, PROTOCOL_VERSION } from '../shared/config';
import { PLAYER_NICKNAME_PATTERN, playerNicknameError, sanitizePlayerName } from '../shared/playerName';
import { parseClientMessage } from '../shared/protocol';
import { buildAnarchyJoinMessage } from '../src/net/AnarchyClient';
import {
  PLAYER_NICKNAME_STORAGE_KEY,
  loadPlayerNickname,
  savePlayerNickname,
  type NicknameStorage,
} from '../src/net/playerNickname';
import { ONLINE_NICKNAME_HINT } from '../src/ui/menuModel';
import gameSource from '../src/core/Game.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';

const LENGTH_ERROR = 'Ник должен содержать от 2 до 13 символов.';
const CHARACTER_ERROR = 'Только английские буквы и цифры.';

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
  it('uses a shared 2–13 Latin/digit contract', () => {
    expect(MIN_PLAYER_NAME_LENGTH).toBe(2);
    expect(MAX_PLAYER_NAME_LENGTH).toBe(13);
    expect(ONLINE_NICKNAME_HINT).toBe('2–13 символов · только A–Z и 0–9');
    expect(PLAYER_NICKNAME_PATTERN.source).toBe('^[A-Za-z0-9]+$');
    for (const name of ['Ab', 'Misha', 'Player123', 'A1', 'a'.repeat(13)]) {
      expect(sanitizePlayerName(name)).toBe(name);
      expect(playerNicknameError(name)).toBeUndefined();
      expect(savePlayerNickname(name, memoryStorage())).toEqual({ ok: true, name });
    }
  });

  it('rejects short, empty, spaced, Cyrillic, symbol, and overlong nicks without trimming', () => {
    const invalid = ['A', '', ' Misha', 'Misha ', 'Mi sha', 'Миша', 'Custom_Nick', 'Custom-Nick', 'a'.repeat(14), 'a'.repeat(20), 'Mi\nsha', 'Mi\tsha'];
    for (const name of invalid) {
      expect(sanitizePlayerName(name), name).toBeUndefined();
      expect(savePlayerNickname(name, memoryStorage()).ok, name).toBe(false);
    }
    expect(playerNicknameError('')).toBe(LENGTH_ERROR);
    expect(playerNicknameError('A')).toBe(LENGTH_ERROR);
    expect(playerNicknameError('a'.repeat(14))).toBe(LENGTH_ERROR);
    expect(playerNicknameError(' Misha')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Misha ')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Mi sha')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Миша')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Custom_Nick')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Custom-Nick')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Mi\nsha')).toBe(CHARACTER_ERROR);
    expect(playerNicknameError('Mi\tsha')).toBe(CHARACTER_ERROR);
    expect(sanitizePlayerName(' Misha ')).toBeUndefined();
  });

  it('keeps an old stored nick that no longer matches, without rewriting it', () => {
    const storage = memoryStorage({ [PLAYER_NICKNAME_STORAGE_KEY]: 'Миша_1' });
    expect(PLAYER_NICKNAME_STORAGE_KEY).toBe('fc.player.nickname');
    expect(loadPlayerNickname(storage)).toBeUndefined();
    expect(storage.data[PLAYER_NICKNAME_STORAGE_KEY]).toBe('Миша_1');
  });

  it('puts a valid nick on the join payload and omits an invalid one', () => {
    const max = 'a'.repeat(13);
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
    expect(buildAnarchyJoinMessage('Миша')).toEqual({
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
      name: max,
    })).toMatchObject({ type: 'join', name: max });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'Custom_Nick',
    })).not.toHaveProperty('name');
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'a'.repeat(14),
    })).not.toHaveProperty('name');
  });

  it('edits the nickname on the online screen, not an account form', () => {
    expect(gameUiSource).toContain('id="online-nickname"');
    expect(gameUiSource).toContain('placeholder="Ваш ник"');
    expect(gameUiSource).toContain('aria-label="Ваш ник"');
    expect(gameUiSource).toContain('minlength="${MIN_PLAYER_NAME_LENGTH}"');
    expect(gameUiSource).toContain('maxlength="${MAX_PLAYER_NAME_LENGTH}"');
    expect(gameUiSource).toContain('>${ONLINE_NICKNAME_HINT}<');
    expect(gameUiSource).toContain('autocomplete="off"');
    expect(gameUiSource).not.toContain('id="account-nickname"');
    expect(gameUiSource).not.toContain('showAccount(');
    expect(gameUiSource).not.toContain('data-action="account"');
    expect(gameSource).toContain('saveNickname:');
    expect(gameSource).toContain('loadPlayerNickname()');
    expect(gameSource).toContain('client.connect(url, loadPlayerNickname(), this.playerAppearance)');
  });
});
