import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../shared/config';
import { parseClientMessage } from '../shared/protocol';
import { captureAttack } from '../src/net/actionIntent';
import { attackMessageFromAttack } from '../src/net/onlineActionMessages';
import gameSource from '../src/core/Game.ts?raw';

describe('online melee action intent', () => {
  it('captures sequenced look plus the exact rendered target timeline', () => {
    const source = { actionSeq: 8, inputSeq: 21, selectedSlot: 3 };
    const captured = captureAttack(
      source,
      { yaw: 1.2, pitch: -0.25 },
      { id: 'remote-player', renderTick: 103.5 },
    );
    expect(captured).toEqual({
      kind: 'attack', actionSeq: 9, commandSeq: 21, selectedSlot: 3,
      yaw: 1.2, pitch: -0.25, targetId: 'remote-player', targetRenderTick: 103.5,
    });
    expect(attackMessageFromAttack(captured)).toEqual({
      type: 'action', kind: 'attack', actionSeq: 9, commandSeq: 21, selectedSlot: 3,
      yaw: 1.2, pitch: -0.25, targetId: 'remote-player', targetRenderTick: 103.5,
    });
  });

  it('keeps air/non-player attacks hint-free and protocol-compatible', () => {
    const action = captureAttack(
      { actionSeq: 0, inputSeq: 4, selectedSlot: 0 },
      { yaw: 0, pitch: 0 },
    );
    expect(action).not.toHaveProperty('targetId');
    expect(parseClientMessage(attackMessageFromAttack(action))).toEqual({
      type: 'action', kind: 'attack', actionSeq: 1, commandSeq: 4,
      selectedSlot: 0, yaw: 0, pitch: 0,
    });
    expect(PROTOCOL_VERSION).toBe(3);
  });

  it('parses fractional render ticks and rejects malformed target hints', () => {
    const base = { type: 'action', kind: 'attack', actionSeq: 1, commandSeq: 2, selectedSlot: 0 };
    expect(parseClientMessage({ ...base, targetId: 'victim', targetRenderTick: 42.25 })).toMatchObject({
      targetId: 'victim', targetRenderTick: 42.25,
    });
    expect(parseClientMessage({ ...base, targetId: 9, targetRenderTick: 42 })).toHaveProperty('error');
    expect(parseClientMessage({ ...base, targetId: 'victim', targetRenderTick: Number.NaN })).toHaveProperty('error');
  });

  it('wires production melee through captureAttack and the sequenced message builder', () => {
    expect(gameSource).toContain('captureAttack(');
    expect(gameSource).toContain('attackMessageFromAttack(action)');
    expect(gameSource).not.toContain("client.send({ type: 'attack' })");
  });
});
