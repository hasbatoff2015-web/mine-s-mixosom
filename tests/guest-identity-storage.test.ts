import { describe, expect, it } from 'vitest';
import { guestEndpointTrusted } from '../src/net/AnarchyClient';
import {
  GUEST_STORAGE_KEY,
  collectLegacyTokens,
  confirmGuestWelcome,
  guestDeploymentId,
  guestScopeKey,
  importGuestCredential,
  planGuestJoin,
  readGuestCredential,
  readGuestStore,
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
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable,
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    expect(plan.outcome).toBe('ready_existing');
    if (plan.outcome !== 'ready_existing') return;
    expect(plan.sendToken).toBe('legacy-token');
    expect(legacy.data['fc.anarchy.sessionToken']).toBe('legacy-token');
    const saved = confirmGuestWelcome(durable, legacy, plan.scope, 'legacy-token', plan.legacyKeys);
    expect(saved.persisted).toBe(true);
    expect(legacy.data['fc.anarchy.sessionToken']).toBeUndefined();
    expect(readGuestCredential(durable, scope)?.sessionToken).toBe('legacy-token');
    const again = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: 'localhost',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable,
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    expect(again.outcome).toBe('ready_existing');
    if (again.outcome === 'ready_existing') expect(again.sendToken).toBe('legacy-token');
  });

  it('does not guess when two legacy tokens disagree', () => {
    const legacy = memoryStore({
      'fc.anarchy.sessionToken': 'one',
      'fc.session.ws://127.0.0.1:2667': 'two',
    });
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: memoryStore(),
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken', 'fc.session.ws://127.0.0.1:2667'],
    });
    expect(plan.outcome).toBe('ambiguous_legacy');
    expect(collectLegacyTokens(legacy, ['fc.anarchy.sessionToken']).token).toBe('one');
  });

  it('does not send a stored token to an untrusted socket override', () => {
    expect(guestEndpointTrusted('ws://127.0.0.1:2567', 'anarchy', '')).toBe(true);
    expect(guestEndpointTrusted('ws://example.test:9', 'anarchy', '?anarchyUrl=ws://example.test:9')).toBe(false);
    expect(guestEndpointTrusted('ws://example.test:9', 'anarchy', '')).toBe(false);
    const plan = planGuestJoin({
      trusted: false,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: memoryStore(),
      legacy: memoryStore({ 'fc.anarchy.sessionToken': 'secret-token' }),
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    if (plan.outcome === 'untrusted') expect(plan.legacyKeys).toEqual([]);
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
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: broken,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('storage_unavailable');
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
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'other-world' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('world_changed');
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('token-a');
  });

  it('does not warn about another world when the other credential is a different mode', () => {
    const store = memoryStore();
    writeGuestCredential(store, scope, 'anarchy-token');
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'survival',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'survival', world: 'survival' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('ready_new');
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('anarchy-token');
  });

  it('does not treat corrupt or unsupported storage as an empty account', () => {
    const corrupt = memoryStore({ [GUEST_STORAGE_KEY]: '{not-json' });
    const before = corrupt.data[GUEST_STORAGE_KEY];
    expect(readGuestStore(corrupt).kind).toBe('corrupt');
    expect(() => writeGuestCredential(corrupt, scope, 'new-token')).toThrow(/corrupt/);
    expect(corrupt.data[GUEST_STORAGE_KEY]).toBe(before);
    const future = memoryStore({ [GUEST_STORAGE_KEY]: JSON.stringify({ version: 9, records: { keep: true } }) });
    const futureRaw = future.data[GUEST_STORAGE_KEY];
    expect(readGuestStore(future).kind).toBe('unsupported');
    expect(() => importGuestCredential(future, scope, 'new-token', true)).toThrow(/unsupported/);
    expect(future.data[GUEST_STORAGE_KEY]).toBe(futureRaw);
  });

  it('refuses to rewrite a document that mixes a valid record with a malformed one', () => {
    const raw = JSON.stringify({
      version: 1,
      records: {
        'local|anarchy|anarchy': { sessionToken: 'good-token' },
        'local|survival|survival': { sessionToken: 'bad token with space' },
      },
    });
    const store = memoryStore({ [GUEST_STORAGE_KEY]: raw });
    expect(readGuestStore(store).kind).toBe('corrupt');
    expect(() => writeGuestCredential(store, scope, 'replacement')).toThrow(/corrupt/);
    expect(store.data[GUEST_STORAGE_KEY]).toBe(raw);
  });

  it('imports one recovery token without replacing the other scopes', () => {
    const store = memoryStore();
    writeGuestCredential(store, { deployment: 'dev', mode: 'anarchy', worldId: 'A' }, 'token-a');
    writeGuestCredential(store, { deployment: 'dev', mode: 'survival', worldId: 'B' }, 'token-b');
    writeGuestCredential(store, { deployment: 'prod', mode: 'anarchy', worldId: 'C' }, 'token-c');
    const beforeB = readGuestCredential(store, { deployment: 'dev', mode: 'survival', worldId: 'B' });
    const beforeC = readGuestCredential(store, { deployment: 'prod', mode: 'anarchy', worldId: 'C' });
    importGuestCredential(store, { deployment: 'dev', mode: 'anarchy', worldId: 'A' }, 'token-a2', true);
    expect(readGuestCredential(store, { deployment: 'dev', mode: 'anarchy', worldId: 'A' })?.sessionToken).toBe('token-a2');
    expect(readGuestCredential(store, { deployment: 'dev', mode: 'anarchy', worldId: 'A' })?.retained).toContain('token-a');
    expect(readGuestCredential(store, { deployment: 'dev', mode: 'survival', worldId: 'B' })).toEqual(beforeB);
    expect(readGuestCredential(store, { deployment: 'prod', mode: 'anarchy', worldId: 'C' })).toEqual(beforeC);
  });
});
