import { describe, expect, it } from 'vitest';
import { guestEndpointTrusted } from '../src/net/AnarchyClient';
import {
  GUEST_STORAGE_KEY,
  collectLegacyTokens,
  confirmGuestWelcome,
  guestDeploymentId,
  guestScopeKey,
  guestScopeStorageKey,
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
    keys() { return Object.keys(data); },
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
    const raw = store.data[guestScopeStorageKey(scope)] ?? '';
    expect(raw).toContain('token-a');
    expect(raw).not.toContain('sessionToken=');
    expect(store.data[guestScopeStorageKey({ ...scope, worldId: 'other' })]).toContain('token-b');
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
      keys() { throw new Error('SecurityError'); },
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

describe('per-scope guest storage', () => {
  const anarchy = { deployment: 'dev', mode: 'anarchy', worldId: 'world-A' };
  const survival = { deployment: 'dev', mode: 'survival', worldId: 'world-B' };
  const prod = { deployment: 'prod', mode: 'anarchy', worldId: 'world-C' };

  it('L stores each scope in its own key', () => {
    const store = memoryStore();
    writeGuestCredential(store, anarchy, 'token-a');
    writeGuestCredential(store, survival, 'token-b');
    writeGuestCredential(store, prod, 'token-c');
    expect(store.data[guestScopeStorageKey(anarchy)]).toContain('token-a');
    expect(store.data[guestScopeStorageKey(survival)]).toContain('token-b');
    expect(store.data[guestScopeStorageKey(prod)]).toContain('token-c');
    const beforeB = store.data[guestScopeStorageKey(survival)];
    const beforeC = store.data[guestScopeStorageKey(prod)];
    writeGuestCredential(store, anarchy, 'token-a2', true);
    expect(store.data[guestScopeStorageKey(survival)]).toBe(beforeB);
    expect(store.data[guestScopeStorageKey(prod)]).toBe(beforeC);
    expect(store.data[guestScopeStorageKey(anarchy)]).not.toBe(beforeB);
  });

  it('M keeps interleaved cross-scope writes', async () => {
    const store = memoryStore();
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
    const writeA = (async () => {
      const previous = readGuestCredential(store, anarchy);
      await gateA;
      writeGuestCredential(store, anarchy, previous?.sessionToken ?? 'token-a');
    })();
    const writeB = (async () => {
      const previous = readGuestCredential(store, survival);
      await gateB;
      writeGuestCredential(store, survival, 'token-b');
      void previous;
    })();
    releaseB();
    releaseA();
    await Promise.all([writeA, writeB]);
    expect(readGuestCredential(store, anarchy)?.sessionToken).toBe('token-a');
    expect(readGuestCredential(store, survival)?.sessionToken).toBe('token-b');
  });

  it('N migrates one v1 record without dropping the others', () => {
    const raw = JSON.stringify({
      version: 1,
      records: {
        [guestScopeKey(anarchy)]: { sessionToken: 'old-a' },
        [guestScopeKey(survival)]: { sessionToken: 'old-b' },
      },
    });
    const store = memoryStore({ [GUEST_STORAGE_KEY]: raw });
    const legacy = memoryStore();
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'world-A' },
      durable: store,
      legacy,
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('ready_existing');
    if (plan.outcome !== 'ready_existing') return;
    expect(plan.sendToken).toBe('old-a');
    const saved = confirmGuestWelcome(store, legacy, plan.scope, 'old-a', []);
    expect(saved.persisted).toBe(true);
    expect(readGuestCredential(store, anarchy)?.sessionToken).toBe('old-a');
    expect(store.data[GUEST_STORAGE_KEY]).toBe(raw);
    expect(readGuestCredential(store, survival)?.sessionToken).toBe('old-b');
  });

  it('O keeps an unmigrated mode after another mode moves to v2', () => {
    const raw = JSON.stringify({
      version: 1,
      records: {
        [guestScopeKey(anarchy)]: { sessionToken: 'old-a' },
        [guestScopeKey(survival)]: { sessionToken: 'old-b' },
      },
    });
    const store = memoryStore({ [GUEST_STORAGE_KEY]: raw });
    confirmGuestWelcome(store, memoryStore(), anarchy, 'old-a', []);
    const survivalPlan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'survival',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'survival', world: 'world-B' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(survivalPlan).toMatchObject({ outcome: 'ready_existing', sendToken: 'old-b' });
    expect(planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'world-A' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    })).toMatchObject({ outcome: 'ready_existing', sendToken: 'old-a' });
  });

  it('P migrates a legacy session token into the scoped record', () => {
    const store = memoryStore();
    const legacy = memoryStore({ 'fc.anarchy.sessionToken': 'legacy-token' });
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: store,
      legacy,
      legacyKeys: ['fc.anarchy.sessionToken'],
    });
    expect(plan).toMatchObject({ outcome: 'ready_existing', sendToken: 'legacy-token' });
    if (plan.outcome !== 'ready_existing') return;
    confirmGuestWelcome(store, legacy, plan.scope, 'legacy-token', plan.legacyKeys);
    expect(readGuestCredential(store, { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })?.sessionToken).toBe('legacy-token');
    expect(legacy.data['fc.anarchy.sessionToken']).toBeUndefined();
  });

  it('Q prefers v2 and leaves a different v1 token in place', () => {
    const scope = { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' };
    const raw = JSON.stringify({ version: 1, records: { [guestScopeKey(scope)]: { sessionToken: 'from-v1' } } });
    const store = memoryStore({
      [GUEST_STORAGE_KEY]: raw,
      [guestScopeStorageKey(scope)]: JSON.stringify({ version: 2, sessionToken: 'from-v2' }),
    });
    expect(readGuestCredential(store, scope)?.sessionToken).toBe('from-v2');
    expect(store.data[GUEST_STORAGE_KEY]).toBe(raw);
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan).toMatchObject({ outcome: 'ready_existing', sendToken: 'from-v2' });
  });

  it('R blocks registration when v1 is corrupt and v2 is absent', () => {
    const raw = '{not-json';
    const store = memoryStore({ [GUEST_STORAGE_KEY]: raw });
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('storage_corrupt');
    expect(store.data[GUEST_STORAGE_KEY]).toBe(raw);
    expect(Object.keys(store.data)).toEqual([GUEST_STORAGE_KEY]);
  });

  it('S does not overwrite a corrupt scoped record', () => {
    const scope = { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' };
    const key = guestScopeStorageKey(scope);
    const store = memoryStore({ [key]: '{' });
    expect(() => writeGuestCredential(store, scope, 'replacement')).toThrow(/corrupt/);
    expect(store.data[key]).toBe('{');
    expect(planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: '127.0.0.1',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'anarchy' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    }).outcome).toBe('storage_corrupt');
  });

  it('T does not replace an unsupported record', () => {
    const scope = { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' };
    const key = guestScopeStorageKey(scope);
    const raw = JSON.stringify({ version: 9, sessionToken: 'future' });
    const store = memoryStore({ [key]: raw });
    expect(() => importGuestCredential(store, scope, 'replacement', true)).toThrow(/unsupported/);
    expect(store.data[key]).toBe(raw);
  });

  it('U imports one scope and rejects a bad token', () => {
    const store = memoryStore();
    writeGuestCredential(store, survival, 'keep-survival');
    writeGuestCredential(store, anarchy, 'old-anarchy');
    expect(() => importGuestCredential(store, anarchy, 'rotated-token', false)).toThrow(/exists/);
    importGuestCredential(store, anarchy, 'rotated-token', true);
    expect(readGuestCredential(store, anarchy)?.sessionToken).toBe('rotated-token');
    expect(readGuestCredential(store, anarchy)?.retained).toContain('old-anarchy');
    expect(readGuestCredential(store, survival)?.sessionToken).toBe('keep-survival');
    expect(() => importGuestCredential(store, prod, 'bad token', true)).toThrow(/invalid/);
    expect(store.data[guestScopeStorageKey(prod)]).toBeUndefined();
  });

  it('V reports a world change stored only in v1', () => {
    const raw = JSON.stringify({
      version: 1,
      records: { 'dev|anarchy|world-A': { sessionToken: 'old-a' } },
    });
    const store = memoryStore({ [GUEST_STORAGE_KEY]: raw });
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'world-B' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('world_changed');
    expect(store.data[GUEST_STORAGE_KEY]).toBe(raw);
  });

  it('W starts Survival without treating an Anarchy credential as a world change', () => {
    const store = memoryStore();
    writeGuestCredential(store, anarchy, 'token-a');
    const plan = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'survival',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'survival', world: 'world-B' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(plan.outcome).toBe('ready_new');
    expect(readGuestCredential(store, anarchy)?.sessionToken).toBe('token-a');
  });

  it('does not treat a key-listing failure as an empty world list', () => {
    const store = memoryStore();
    writeGuestCredential(store, anarchy, 'token-a');
    store.keys = () => { throw new Error('SecurityError'); };
    const blocked = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'world-b' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(blocked.outcome).toBe('storage_unavailable');
    const resumed = planGuestJoin({
      trusted: true,
      freshGuest: false,
      allowEphemeral: false,
      targetMode: 'anarchy',
      hostname: 'dev.megacraft.agariobrainrot.ru',
      status: { ok: true, ready: true, mode: 'anarchy', world: 'world-A' },
      durable: store,
      legacy: memoryStore(),
      legacyKeys: [],
    });
    expect(resumed).toMatchObject({ outcome: 'ready_existing', sendToken: 'token-a' });
  });
});
