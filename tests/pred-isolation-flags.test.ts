import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../shared/protocol';
import { resolvePredIsolation } from '../src/net/predIsolation';

describe('pred isolation flags', () => {
  it('ignores every flag outside DEV', () => {
    expect(resolvePredIsolation('?predNoNet=1', { dev: false })).toEqual({
      noSend: false,
      noState: false,
      mode: 'normal',
    });
    expect(resolvePredIsolation('?predNoState=1&predNoSend=1', { dev: false }).mode).toBe('normal');
  });

  it('treats predNoNet as send+state isolation', () => {
    expect(resolvePredIsolation('?predNoNet=1', { dev: true })).toEqual({
      noSend: true,
      noState: true,
      mode: 'noNet',
    });
    expect(resolvePredIsolation('?prednonet=true', { dev: true }).mode).toBe('noNet');
  });

  it('enables predNoState and predNoSend independently', () => {
    expect(resolvePredIsolation('?predNoState=1', { dev: true })).toEqual({
      noSend: false,
      noState: true,
      mode: 'noState',
    });
    expect(resolvePredIsolation('?predNoSend=1', { dev: true })).toEqual({
      noSend: true,
      noState: false,
      mode: 'noSend',
    });
  });

  it('combining predNoState and predNoSend equals predNoNet', () => {
    expect(resolvePredIsolation('?predNoState=1&predNoSend=1', { dev: true }).mode).toBe('noNet');
  });

  it('stays normal without query flags in DEV', () => {
    expect(resolvePredIsolation('', { dev: true }).mode).toBe('normal');
    expect(resolvePredIsolation('?foo=1', { dev: true }).mode).toBe('normal');
  });
});

describe('input timing field', () => {
  it('forwards optional clientSentAt on input packets', () => {
    const parsed = parseClientMessage({
      type: 'input',
      seq: 3,
      forward: 1,
      right: 0,
      jump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: 0,
      pitch: 0,
      selectedSlot: 0,
      clientSentAt: 12.5,
    });
    expect(parsed).toMatchObject({ type: 'input', seq: 3, clientSentAt: 12.5 });
  });
});
