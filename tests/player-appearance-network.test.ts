import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../shared/config';
import {
  encodeMessage,
  parseClientMessage,
  parseServerMessage,
} from '../shared/protocol';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import { buildAnarchyJoinMessage } from '../src/net/AnarchyClient';
import gameSource from '../src/core/Game.ts?raw';

const slim = createPlayerAppearance({
  skinId: 'e3eb6f99ea1c3fe1',
  model: 'slim',
});

describe('player appearance network metadata', () => {
  it('puts appearance metadata on join and omits texture bytes', () => {
    const join = buildAnarchyJoinMessage('Misha', undefined, slim);
    expect(join).toEqual({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      name: 'Misha',
      appearance: {
        skinId: slim.skinId,
        model: 'slim',
        layers: slim.layers,
      },
    });
    const encoded = encodeMessage(join);
    expect(encoded).not.toMatch(/png|base64|data:image|texture/i);
    expect(parseClientMessage(JSON.parse(encoded))).toEqual(join);
  });

  it('parses appearance change messages and rejects PNG payloads', () => {
    const parsed = parseClientMessage({
      type: 'appearance',
      skinId: slim.skinId,
      model: 'slim',
      layers: slim.layers,
    });
    expect(parsed).toMatchObject({
      type: 'appearance',
      skinId: slim.skinId,
      model: 'slim',
    });
    expect(JSON.stringify(parsed)).not.toMatch(/png|base64/i);
    expect(parseClientMessage({
      type: 'appearance',
      skinId: slim.skinId,
      model: 'slim',
      png: 'iVBORw0KGgo=',
    })).toEqual({ error: 'appearance invalid' });
    expect(parseClientMessage({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      appearance: { skinId: slim.skinId, texture: 'bytes' },
    })).toEqual({ error: 'join.appearance invalid' });
  });

  it('carries appearance on welcome/player_joined and the rare player_appearance event', () => {
    const welcome = parseServerMessage({
      type: 'welcome',
      you: { ...DEFAULT_PLAYER_APPEARANCE, appearance: slim, id: 'a', name: 'A' },
    });
    expect(welcome).toMatchObject({ type: 'welcome' });
    const joined = parseServerMessage({
      type: 'player_joined',
      player: { id: 'b', name: 'B', x: 0, y: 70, z: 0, yaw: 0, pitch: 0, appearance: slim, health: 20 },
    });
    expect(joined).toMatchObject({ type: 'player_joined' });
    const change = parseServerMessage({
      type: 'player_appearance',
      playerId: 'b',
      appearance: slim,
    });
    expect(change).toEqual({
      type: 'player_appearance',
      playerId: 'b',
      appearance: slim,
    });
    expect(parseServerMessage({
      type: 'player_appearance',
      playerId: 'b',
      appearance: { skinId: slim.skinId, png: 'nope' },
    })).toEqual({ error: 'player_appearance invalid' });
  });

  it('keeps Game using setPlayerAppearance as the live apply path and does not put appearance on ticks', () => {
    expect(gameSource).toContain("type: 'appearance'");
    expect(gameSource).toContain('this.setPlayerAppearance(appearance)');
    expect(gameSource).toContain('applyOnlineAppearance');
    expect(gameSource).toContain('info.appearance ?? DEFAULT_PLAYER_APPEARANCE');
  });
});
