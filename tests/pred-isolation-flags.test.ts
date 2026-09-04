import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../shared/protocol';
import { resolvePredIsolation, type PredIsolationFlags } from '../src/net/predIsolation';

const OFF: PredIsolationFlags = {
  noSend: false,
  noState: false,
  observe: false,
  skipReconcile: false,
  skipSurvival: false,
  skipRiding: false,
  skipGamemode: false,
  skipRespawn: false,
  skipLook: false,
  skipRender: false,
  mode: 'normal',
};

describe('pred isolation flags', () => {
  it('ignores every flag outside DEV', () => {
    expect(resolvePredIsolation('?predNoNet=1', { dev: false })).toEqual(OFF);
    expect(resolvePredIsolation('?predNoState=1&predNoSend=1', { dev: false }).mode).toBe('normal');
    expect(resolvePredIsolation('?predStateObserve=1', { dev: false }).mode).toBe('normal');
  });

  it('treats predNoNet as send+state isolation', () => {
    expect(resolvePredIsolation('?predNoNet=1', { dev: true })).toEqual({
      ...OFF,
      noSend: true,
      noState: true,
      mode: 'noNet',
    });
    expect(resolvePredIsolation('?prednonet=true', { dev: true }).mode).toBe('noNet');
  });

  it('enables predNoState and predNoSend independently', () => {
    expect(resolvePredIsolation('?predNoState=1', { dev: true })).toEqual({
      ...OFF,
      noSend: false,
      noState: true,
      mode: 'noState',
    });
    expect(resolvePredIsolation('?predNoSend=1', { dev: true })).toEqual({
      ...OFF,
      noSend: true,
      noState: false,
      mode: 'noSend',
    });
  });

  it('combining predNoState and predNoSend equals predNoNet', () => {
    expect(resolvePredIsolation('?predNoState=1&predNoSend=1', { dev: true }).mode).toBe('noNet');
  });

  it('predStateObserve receives/parses but implies noState so nothing is mutated', () => {
    expect(resolvePredIsolation('?predStateObserve=1', { dev: true })).toEqual({
      ...OFF,
      noSend: false,
      noState: true,
      observe: true,
      mode: 'observe',
    });
  });

  it('enables category skips independently of send/state isolation', () => {
    const flags = resolvePredIsolation(
      '?predSkipReconcile=1&predSkipSurvival=1&predSkipRiding=1&predSkipGamemode=1&predSkipRespawn=1&predSkipLook=1&predSkipRender=1',
      { dev: true },
    );
    expect(flags).toMatchObject({
      skipReconcile: true,
      skipSurvival: true,
      skipRiding: true,
      skipGamemode: true,
      skipRespawn: true,
      skipLook: true,
      skipRender: true,
      mode: 'normal',
      noState: false,
      noSend: false,
    });
  });

  it('stays normal without query flags in DEV', () => {
    expect(resolvePredIsolation('', { dev: true })).toEqual(OFF);
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
