import { describe, expect, it } from 'vitest';
import { guestEndpointTrusted } from '../src/net/AnarchyClient';
import {
  GUEST_STORAGE_KEY,
  collectLegacyTokens,
  confirmGuestWelcome,
  guestDeploymentId,
  guestScopeKey,
  planGuestJoin,
  readGuestCredential,
  writeGuestCredential,
  type GuestStorage,
} from '../src/net/guestIdentityStorage';

function memoryStore(initial: Record<string, string> = {}): GuestStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null; },
    setItem(key, value) { data[key] = value; },
    removeItem(key) { delete data[key]; },
  };
}

const scope = { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' };

describe('guest identity storage', () => {
  it('keeps dev and prod credentials apart', () => {
    expect(guestDeploymentId('dev.megacraft.agariobrainrot.ru')).toBe('dev');
    expect(guestDeploymentId('megacraft.agariobrainrot.ru')).toBe('prod');
    expect(guestDeploymentId('127.0.0.1')).toBe('local');
    expect(guestScopeKey({ deployment: 'dev', mode: 'anarchy', worldId: 'anarchy' }))
      .not.toBe(guestScopeKey({ deployment: 'prod', mode: 'anarchy', worldId: 'anarchy' }));
  });

  it('restores a saved token for the same world and keeps another world', () => {
    const store = memoryStore();
    writeGuestCredential(store, scope, 'token-a');
    writeGuestCredential(store, { ...scope, worldId: 'other' }, 'token-b');
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('token-a');
    expect(readGuestCredential(store, { ...scope, worldId: 'other' })?.sessionToken).toBe('token-b');
    const raw = store.data[GUEST_STORAGE_KEY] ?? '';
    expect(raw).toContain('token-a');
    expect(raw).not.toContain('sessionToken=');
  });

  it('migrates one legacy token and does not delete it before confirmation', () => {
    const durable = memoryStore();
    const legacy = memoryStore({ 'fc.anarchy.sessionToken': 'legacy-token' });
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable,
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    expect(plan.sendToken).toBe('legacy-token');
    expect(legacy.data['fc.anarchy.sessionToken']).toBe('legacy-token');
    const saved = confirmGuestWelcome(durable, legacy, plan.scope, 'legacy-token', plan.legacyKeys);
    expect(saved.persisted).toBe(true);
    expect(legacy.data['fc.anarchy.sessionToken']).toBeUndefined();
    expect(readGuestCredential(durable, scope)?.sessionToken).toBe('legacy-token');
    const again = planGuestJoin({
      trusted: true,
      freshGuest: false,
      hostname: 'localhost',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable,
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    expect(again.sendToken).toBe('legacy-token');
  });

  it('does not guess when two legacy tokens disagree', () => {
    const legacy = memoryStore({
      'fc.anarchy.sessionToken': 'one',
      'fc.session.ws://127.0.0.1:2667': 'two',
    });
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: memoryStore(),
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken', 'fc.session.ws://127.0.0.1:2667'],
    });
    expect(plan.blocked).toBe('ambiguous');
    expect(plan.sendToken).toBeUndefined();
    expect(collectLegacyTokens(legacy, ['fc.anarchy.sessionToken']).token).toBe('one');
  });

  it('does not send a stored token to an untrusted socket override', () => {
    expect(guestEndpointTrusted('ws://127.0.0.1:2567', '')).toBe(true);
    expect(guestEndpointTrusted('ws://example.test:9', '?anarchyUrl=ws://example.test:9')).toBe(false);
    const plan = planGuestJoin({
      trusted: false,
      freshGuest: false,
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: memoryStore(),
      legacy: memoryStore({ 'fc.anarchy.sessionToken': 'secret-token' }),
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    expect(plan.sendToken).toBeUndefined();
  });

  it('reports storage failure without throwing or wiping a previous record', () => {
    const store = memoryStore();
    writeGuestCredential(store, scope, 'keep-me');
    const broken: GuestStorage = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('SecurityError'); },
    };
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: broken,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.warning).toBe('storage');
    expect(plan.sendToken).toBeUndefined();
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('keep-me');
    const saved = confirmGuestWelcome(broken, null, scope, 'new-token', []);
    expect(saved.persisted).toBe(false);
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('keep-me');
  });

  it('keeps the previous token when a new guest is confirmed for the same world', () => {
    const store = memoryStore();
    writeGuestCredential(store, scope, 'old-token');
    writeGuestCredential(store, scope, 'new-token');
    const record = readGuestCredential(store, scope);
    expect(record?.sessionToken).toBe('new-token');
    expect(record?.retained).toContain('old-token');
  });

  it('does not treat a different world as the saved character', () => {
    const store = memoryStore();
    writeGuestCredential(store, scope, 'token-a');
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'other-world' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.sendToken).toBeUndefined();
    expect(plan.warning).toBe('other-world');
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('token-a');
  });
});
