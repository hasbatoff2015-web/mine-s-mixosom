import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';
import { yandexLinkResultApplies, type YandexLinkWait } from '../src/net/yandexLinkCorrelation';

function wait(patch: Partial<YandexLinkWait> = {}): YandexLinkWait {
  return {
    busy: true,
    op: 2,
    waitOp: 2,
    requestId: 'request-bbb',
    ...patch,
  };
}

describe('yandex link request correlation', () => {
  it('lets a late reply finish only the request that is still waiting', () => {
    const first = wait({ op: 1, waitOp: 1, requestId: 'request-aaa' });
    const timedOut = wait({ busy: false, op: 1, waitOp: 1, requestId: '' });
    const second = wait();
    expect(yandexLinkResultApplies(timedOut, { requestId: 'request-aaa' })).toBe(false);
    expect(yandexLinkResultApplies(second, { requestId: 'request-aaa' })).toBe(false);
    expect(yandexLinkResultApplies(second, { requestId: 'request-bbb' })).toBe(true);
    expect(yandexLinkResultApplies(second, { requestId: 'request-bbb' })).toBe(true);
    expect(yandexLinkResultApplies({ ...second, busy: false }, { requestId: 'request-bbb' })).toBe(false);
    expect(yandexLinkResultApplies(second, {})).toBe(false);
    expect(yandexLinkResultApplies({ ...second, op: 3 }, { requestId: 'request-bbb' })).toBe(false);
    expect(yandexLinkResultApplies(first, { requestId: 'request-bbb' })).toBe(false);
  });

  it('rejects a bad request id and still accepts an old message without one', () => {
    expect(parseClientMessage({ type: 'auth_link', proof: 'abc', requestId: 'request-aaa' })).toMatchObject({
      type: 'auth_link',
      requestId: 'request-aaa',
    });
    expect(parseClientMessage({ type: 'auth_link', proof: 'abc' })).toEqual({ type: 'auth_link', proof: 'abc' });
    expect(parseClientMessage({ type: 'auth_link', proof: 'abc', requestId: '../secret' })).toEqual({
      error: 'auth.requestId invalid',
    });
    expect(parseClientMessage({ type: 'auth_link', proof: 'abc', requestId: 'short' })).toEqual({
      error: 'auth.requestId invalid',
    });
    expect(parseServerMessage({ type: 'auth_result', action: 'link', status: 'linked', requestId: 'request-bbb' })).toMatchObject({
      type: 'auth_result',
      requestId: 'request-bbb',
      status: 'linked',
    });
    expect(parseServerMessage({ type: 'auth_result', action: 'link', status: 'linked' })).toEqual({
      type: 'auth_result',
      action: 'link',
      status: 'linked',
    });
    expect(parseClientMessage({ type: 'join', protocol: 4 })).toHaveProperty('type', 'join');
  });
});
