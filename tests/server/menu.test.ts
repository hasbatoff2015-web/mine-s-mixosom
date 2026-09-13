import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { parseClientMessage } from '../../shared/protocol';
import {
  CLAIM_MAX_OWNED,
  CLAIM_MEMBER_SELF_ERROR,
  CLAIM_NAME_TAKEN_ERROR,
  showsMenuBack,
} from '../../shared/menu';
import { HOME_LIMIT_ERROR, HOME_NAME_TAKEN_ERROR } from '../../shared/homes';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import { FriendService } from '../../server/services/friends';
import { HomeService } from '../../server/services/home';
import { MenuService } from '../../server/services/menu';
import { TradeService } from '../../server/services/trade';
import { CLAIM_PRIORITY_DEFAULT, type Claim } from '../../server/services/claims';

describe('menu protocol', () => {
  it('parses menu intents and rejects unknown actions', () => {
    expect(parseClientMessage({ type: 'menu_action', action: 'open' })).toMatchObject({
      type: 'menu_action',
      action: 'open',
    });
    expect(parseClientMessage({ type: 'menu_action', action: 'explode' })).toEqual({
      error: 'menu_action.action invalid',
    });
  });

  it('keeps nested screens behind the shared back helper', () => {
    expect(showsMenuBack('main')).toBe(false);
    expect(showsMenuBack('friends')).toBe(true);
    expect(showsMenuBack('claim-detail')).toBe(true);
    expect(showsMenuBack('trade-session')).toBe(false);
  });
});

describe('MenuService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(extraClaims: readonly Partial<Claim>[] = []) {
    const dir = await mkdtemp(join(tmpdir(), 'fc-menu-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const homes = new HomeService(store);
    const friends = new FriendService(store);
    const trades = new TradeService(store, economy);
    const menu = new MenuService(store, economy, homes, friends, trades);
    const inventories = new Map<string, Inventory>([['ada', new Inventory()]]);
    const displayName = (id: string) => (id === 'ada' ? 'Ada' : id === 'bob' ? 'Bob' : id);
    const lookupPlayer = (raw: string) => {
      const key = raw.trim().toLowerCase();
      if (key === 'ada') return { id: 'ada', name: 'Ada' };
      if (key === 'bob') return { id: 'bob', name: 'Bob' };
      return undefined;
    };
    trades.setRuntime({
      isOnline: () => true,
      displayName,
      lookupPlayer,
      inventory: (id) => inventories.get(id),
      flushInventory: () => undefined,
    });
    menu.setRuntime({
      displayName,
      ownerKey: (id) => (id === 'ada' ? 'ada' : id),
      isOnline: () => true,
      lookupPlayer,
      position: () => ({ x: 12, y: 64, z: -8 }),
      worldId: () => 'anarchy',
      inventory: (id) => inventories.get(id),
      inClan: () => false,
      clanNotice: () => 'Bob хочет вступить в клан',
      maxHomes: () => 4,
      teleportHome: (_id, name) => (homes.find('ada', name) ? { ok: true } : { ok: false, error: 'missing' }),
      runSpawn: () => ({ ok: true }),
    });
    const claim: Claim = {
      id: 'claim-1',
      name: 'Алмазный приват',
      owner: 'ada',
      worldId: 'anarchy',
      volume: { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 80, maxZ: 10 },
      members: ['bob'],
      priority: CLAIM_PRIORITY_DEFAULT,
      flags: { pvp: false },
    };
    const claims = [claim, ...extraClaims.map((extra, index): Claim => ({
      ...claim,
      id: `claim-${index + 2}`,
      name: `Приват ${index + 2}`,
      members: [],
      ...extra,
    }))];
    store.save('claims/claims', { claims });
    return { menu, homes, trades, inventories };
  }

  it('opens the main shell, spawn-closes, and pages homes/friends/claims/auction', async () => {
    const { menu } = await setup();
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'open' }).ok).toBe(true);
    const main = menu.buildMessage('ada');
    expect(main.screen).toBe('main');
    expect(main.clanNotice).toContain('клан');
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'spawn' }).close).toBe(true);
    menu.handleAction('ada', { type: 'menu_action', action: 'open' });
    menu.handleAction('ada', { type: 'menu_action', action: 'open_homes' });
    expect(menu.buildMessage('ada').screen).toBe('homes');
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'create_home', name: 'Дом' }).ok).toBe(true);
    expect(menu.buildMessage('ada').homes).toHaveLength(1);
    menu.handleAction('ada', { type: 'menu_action', action: 'delete_home', name: 'Дом' });
    expect(menu.buildMessage('ada').screen).toBe('home-delete-confirm');
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'confirm_delete_home' }).ok).toBe(true);
    expect(menu.buildMessage('ada').homes).toHaveLength(0);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'open_auction_browse' }).openAuction).toBe('browse');
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'open_clan_list' }).openClan).toBe('ranking');
  });

  it('lists, renames, toggles PvP, edits members, and deletes claims', async () => {
    const { menu } = await setup();
    menu.handleAction('ada', { type: 'menu_action', action: 'open_claims' });
    const list = menu.buildMessage('ada');
    expect(list.claims).toHaveLength(1);
    expect(list.claimMax).toBe(CLAIM_MAX_OWNED);
    menu.handleAction('ada', { type: 'menu_action', action: 'open_claim', claimId: 'claim-1' });
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'save_claim_name', name: 'Каменный приват' }).ok).toBe(true);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'set_claim_pvp', pvp: true }).ok).toBe(true);
    expect(menu.buildMessage('ada').claim?.pvp).toBe(true);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'remove_claim_member', name: 'bob' }).ok).toBe(true);
    expect(menu.buildMessage('ada').claim?.members).toEqual([]);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'add_claim_member', name: 'Bob' }).ok).toBe(true);
    menu.handleAction('ada', { type: 'menu_action', action: 'delete_claim' });
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'confirm_delete_claim' }).ok).toBe(true);
    expect(menu.buildMessage('ada').claims).toHaveLength(0);
  });

  it('keeps home names unique per player and stops at four homes', async () => {
    const { menu, homes } = await setup();
    menu.handleAction('ada', { type: 'menu_action', action: 'open_homes' });
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'create_home', name: 'Дом' }).ok).toBe(true);
    const duplicate = menu.handleAction('ada', { type: 'menu_action', action: 'create_home', name: 'дом' });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toBe(HOME_NAME_TAKEN_ERROR);
    expect(menu.buildMessage('ada').homes).toHaveLength(1);
    expect(homes.find('ada', 'Дом')?.x).toBe(12);

    for (const name of ['Шахта', 'Ферма', 'База']) {
      expect(menu.handleAction('ada', { type: 'menu_action', action: 'create_home', name }).ok).toBe(true);
    }
    const full = menu.handleAction('ada', { type: 'menu_action', action: 'create_home', name: 'Лишний' });
    expect(full.error).toBe(HOME_LIMIT_ERROR);
    const list = menu.buildMessage('ada');
    expect(list.homes).toHaveLength(4);
    expect(list.homeMax).toBe(4);
    expect(list.message).toBe(HOME_LIMIT_ERROR);

    const teleport = menu.handleAction('ada', { type: 'menu_action', action: 'teleport_home', homeName: 'Шахта' });
    expect(teleport.close).toBe(true);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'teleport_home', homeName: 'Нет' }).ok).toBe(false);
  });

  it('rejects a duplicate claim name and refuses the owner as a member', async () => {
    const { menu } = await setup([{ name: 'Каменный приват' }]);
    menu.handleAction('ada', { type: 'menu_action', action: 'open_claims' });
    expect(menu.buildMessage('ada').claims).toHaveLength(2);
    menu.handleAction('ada', { type: 'menu_action', action: 'open_claim', claimId: 'claim-1' });
    const taken = menu.handleAction('ada', { type: 'menu_action', action: 'save_claim_name', name: 'каменный приват' });
    expect(taken.error).toBe(CLAIM_NAME_TAKEN_ERROR);
    expect(menu.buildMessage('ada').claim?.name).toBe('Алмазный приват');
    const own = menu.handleAction('ada', { type: 'menu_action', action: 'add_claim_member', name: 'Ada' });
    expect(own.error).toBe(CLAIM_MEMBER_SELF_ERROR);
    expect(menu.buildMessage('ada').claim?.members).toEqual(['bob']);
  });

  it('cancels an open trade when the menu itself is closed with X or E', async () => {
    const { menu, trades, inventories } = await setup();
    inventories.set('bob', new Inventory());
    inventories.get('ada')!.setSlot(0, createItemStack('stone', 32));
    expect(trades.request('ada', 'Bob').ok).toBe(true);
    expect(trades.acceptRequest('bob', 'ada').ok).toBe(true);
    menu.handleAction('ada', { type: 'menu_action', action: 'select_inventory_slot', slot: 0 });
    menu.handleAction('ada', { type: 'menu_action', action: 'click_offer_slot', slot: 0 });
    expect(menu.buildMessage('ada').screen).toBe('trade-session');
    expect(inventories.get('ada')!.getSlot(0)).toBeNull();

    const closed = menu.handleAction('ada', { type: 'menu_action', action: 'close' });
    expect(closed.close).toBe(true);
    expect(trades.sessionFor('ada')).toBeUndefined();
    expect(trades.sessionFor('bob')).toBeUndefined();
    expect(inventories.get('ada')!.getSlot(0)?.count).toBe(32);
  });

  it('gates my-clan on membership and offers clan create instead', async () => {
    const { menu } = await setup();
    menu.handleAction('ada', { type: 'menu_action', action: 'open_clans' });
    const hub = menu.buildMessage('ada');
    expect(hub.screen).toBe('clans');
    expect(hub.inClan).toBe(false);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'open_my_clan' }).ok).toBe(false);
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'open_create_clan' }).openClan).toBe('create');
  });

  it('returns nested pages with back instead of closing the shell', async () => {
    const { menu } = await setup();
    menu.handleAction('ada', { type: 'menu_action', action: 'open' });
    menu.handleAction('ada', { type: 'menu_action', action: 'open_friends' });
    expect(menu.handleAction('ada', { type: 'menu_action', action: 'back' }).ok).toBe(true);
    expect(menu.buildMessage('ada').screen).toBe('main');
    menu.handleAction('ada', { type: 'menu_action', action: 'open_claims' });
    menu.handleAction('ada', { type: 'menu_action', action: 'open_claim', claimId: 'claim-1' });
    menu.handleAction('ada', { type: 'menu_action', action: 'back' });
    expect(menu.buildMessage('ada').screen).toBe('claims');

    menu.handleAction('ada', { type: 'menu_action', action: 'open_claim', claimId: 'claim-1' });
    menu.handleAction('ada', { type: 'menu_action', action: 'delete_claim' });
    menu.handleAction('ada', { type: 'menu_action', action: 'back' });
    expect(menu.buildMessage('ada').screen).toBe('claim-detail');

    menu.handleAction('ada', { type: 'menu_action', action: 'open_homes' });
    menu.handleAction('ada', { type: 'menu_action', action: 'create_home', name: 'Дом' });
    menu.handleAction('ada', { type: 'menu_action', action: 'delete_home', homeName: 'Дом' });
    menu.handleAction('ada', { type: 'menu_action', action: 'back' });
    expect(menu.buildMessage('ada').screen).toBe('homes');
    expect(menu.buildMessage('ada').homes).toHaveLength(1);
  });
});
