/**
 * @vitest-environment happy-dom
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inventory, createItemStack } from '../src/inventory';
import { JsonFileStore } from '../server/services/jsonStore';
import { EconomyService } from '../server/services/economy';
import { buildTradeMessage } from '../server/services/gameMenu';
import { TradeService } from '../server/services/trade';
import { TRADE_MONEY_ERROR } from '../shared/trade';
import type {
  ClientMenuActionMessage,
  ClientTradeActionMessage,
  ServerAuctionMessage,
  ServerBuyerMessage,
  ServerClanMessage,
  ServerMenuMessage,
  ServerTradeMessage,
} from '../shared/protocol';
import { GameUI } from '../src/ui/GameUI';
import { planAuthoritativeField } from '../src/ui/preserveFocusedField';

const sessions: GameUI[] = [];
const dirs: string[] = [];

afterEach(async () => {
  sessions.splice(0).forEach((ui) => {
    ui.closeGameMenu?.();
  });
  document.body.innerHTML = '';
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mount(): { root: HTMLElement; ui: GameUI } {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  sessions.push(ui);
  return { root, ui };
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string, caret = value.length): void {
  input.focus();
  input.value = value;
  try { input.setSelectionRange(caret, caret); } catch { /* number inputs */ }
  input.dispatchEvent(new Event('input'));
}

describe('authoritative field planner', () => {
  it('keeps a newer draft and clears it only after the echo caught up', () => {
    const stale = planAuthoritativeField({
      focused: true,
      composing: false,
      current: 'Дом',
      server: 'Д',
      lastEcho: '',
      pendingSent: 'Дом',
    });
    expect(stale.value).toBe('Дом');
    const caught = planAuthoritativeField({
      focused: true,
      composing: false,
      current: 'Дом',
      server: 'Дом',
      lastEcho: stale.lastEcho,
      pendingSent: stale.pendingSent,
    });
    expect(caught.value).toBe('Дом');
    expect(caught.lastEcho).toBe('Дом');
    const cleared = planAuthoritativeField({
      focused: true,
      composing: false,
      current: 'Дом',
      server: '',
      lastEcho: caught.lastEcho,
      pendingSent: caught.pendingSent,
    });
    expect(cleared.value).toBe('');
    const composing = planAuthoritativeField({
      focused: true,
      composing: true,
      current: 'Дом',
      server: '',
      lastEcho: 'Дом',
      pendingSent: null,
    });
    expect(composing.value).toBe('Дом');
  });
});

describe('menu forms stay live while a field is focused', () => {
  it('shows a new friend request without replacing the nick field', () => {
    const { root, ui } = mount();
    const sent: ClientMenuActionMessage[] = [];
    const base: ServerMenuMessage = {
      type: 'menu',
      screen: 'friends',
      title: 'Друзья',
      friendNameText: '',
      friendRequests: [],
      friends: [],
      friendCount: 0,
      friendMax: 10,
      message: '',
    };
    ui.openGameMenu(base, { send: (message) => sent.push(message), close() {} });
    const input = root.querySelector<HTMLInputElement>('[data-menu-friend-name]')!;
    typeInto(input, 'Стив');
    ui.applyGameMenu({
      ...base,
      friendNameText: 'С',
      friendRequests: [{ playerId: 'bob', name: 'Боб', online: true, canTeleport: false, requestId: 'req-1' }],
      message: 'Уже в друзьях',
    });
    expect(root.querySelector('[data-menu-friend-name]')).toBe(input);
    expect(input.value).toBe('Стив');
    expect(input.selectionStart).toBe(4);
    expect(document.activeElement).toBe(input);
    const accept = root.querySelector<HTMLButtonElement>('[data-menu-friend-accept="req-1"]');
    expect(accept).toBeTruthy();
    expect(root.querySelectorAll('[data-menu-friend-accept]')).toHaveLength(1);
    expect(root.querySelector('[data-menu-message]')?.textContent).toBe('Уже в друзьях');
    accept!.click();
    expect(sent.filter((message) => message.action === 'friends_accept')).toHaveLength(1);
    expect(sent.filter((message) => message.action === 'set_friend_name')).toHaveLength(1);
  });

  it('clears a home draft only after the server echoes it and then accepts the create', () => {
    const { root, ui } = mount();
    const base: ServerMenuMessage = {
      type: 'menu',
      screen: 'homes',
      title: 'Дома',
      homes: [],
      homeNameText: '',
      homeCount: 0,
      homeMax: 3,
    };
    ui.openGameMenu(base, { send() {}, close() {} });
    const input = root.querySelector<HTMLInputElement>('[data-menu-home-name]')!;
    typeInto(input, 'Дом');
    ui.applyGameMenu({ ...base, homeNameText: 'Дом', message: '' });
    expect(input.value).toBe('Дом');
    ui.applyGameMenu({
      ...base,
      homeNameText: '',
      homes: [{ name: 'Дом', x: 4, y: 5, z: 6 }],
      homeCount: 1,
      message: '',
    });
    expect(root.querySelector('[data-menu-home-name]')).toBe(input);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('.mc-menu-list')?.textContent).toContain('Дом');
    expect(root.querySelector('.mc-menu-count')?.textContent).toContain('1/3');
    typeInto(input, 'Новый');
    ui.applyGameMenu({
      ...base,
      homeNameText: 'Дом',
      homeCount: 1,
      homes: [{ name: 'Дом', x: 4, y: 5, z: 6 }],
    });
    expect(input.value).toBe('Новый');
  });

  it('updates claim members and does not carry a draft onto another claim', () => {
    const { root, ui } = mount();
    const base: ServerMenuMessage = {
      type: 'menu',
      screen: 'claim-settings',
      title: 'Приват',
      claimId: 'claim-a',
      claimNameText: '',
      claimMemberText: '',
      claimMembers: [],
      claimPvp: false,
    };
    ui.openGameMenu(base, { send() {}, close() {} });
    const name = root.querySelector<HTMLInputElement>('[data-menu-claim-name]')!;
    typeInto(name, 'База');
    ui.applyGameMenu({
      ...base,
      claimNameText: 'Б',
      claimMembers: [{ name: 'Гриша' }],
      claimPvp: true,
      message: 'Игрок не найден',
    });
    expect(root.querySelector('[data-menu-claim-name]')).toBe(name);
    expect(name.value).toBe('База');
    expect(root.querySelector('[data-menu-claim-kick="Гриша"]')).toBeTruthy();
    expect(root.querySelector('[data-menu-claim-pvp]')?.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('[data-menu-message]')?.textContent).toBe('Игрок не найден');
    ui.applyGameMenu({ ...base, claimId: 'claim-b', claimNameText: 'Склад', claimMembers: [] });
    const next = root.querySelector<HTMLInputElement>('[data-menu-claim-name]');
    expect(next).toBeTruthy();
    expect(next).not.toBe(name);
    expect(next!.value).toBe('Склад');
    expect(root.querySelector('[data-menu-context]')?.getAttribute('data-menu-context')).toBe('claim-b');
  });

  it('shows a nearby trade offer while the nick field stays put', () => {
    const { root, ui } = mount();
    const base: ServerMenuMessage = {
      type: 'menu',
      screen: 'trade',
      title: 'Обмен',
      tradeNameText: '',
      tradeNearby: [],
      tradeIncoming: [],
      tradeOutgoing: [],
    };
    ui.openGameMenu(base, { send() {}, close() {} });
    const input = root.querySelector<HTMLInputElement>('[data-menu-trade-name]')!;
    typeInto(input, 'Боб');
    ui.applyGameMenu({
      ...base,
      tradeNameText: 'Б',
      tradeNearby: [{ playerId: 'bob', name: 'Боб', distance: 4 }],
      message: 'Запрос отправлен',
    });
    expect(root.querySelector('[data-menu-trade-name]')).toBe(input);
    expect(input.value).toBe('Боб');
    expect(root.querySelector('[data-menu-trade-nearby="Боб"]')).toBeTruthy();
    expect(root.querySelector('[data-menu-message]')?.textContent).toBe('Запрос отправлен');
  });

  it('updates the donate rank and keeps the announcement draft', () => {
    const { root, ui } = mount();
    const donate = {
      rankLabel: 'VIP',
      summary: '',
      remainingLabel: '3 дня',
      perks: [],
      actions: [{ id: 'announce', label: 'Объявление', available: true, detail: 'Раз в час', screen: 'donate-announce' as const }],
      kits: [],
      catalog: [],
      nickChoices: [],
      previewName: 'Ada',
      onlinePlayers: [],
      showInvseeOp: false,
    };
    ui.openGameMenu({
      type: 'menu',
      screen: 'donate-announce',
      title: 'Донат',
      donate,
    }, { send() {}, close() {} });
    const field = root.querySelector<HTMLTextAreaElement>('[data-donate-announce]')!;
    typeInto(field, 'Привет сервер');
    ui.applyGameMenu({
      type: 'menu',
      screen: 'donate-announce',
      title: 'Донат',
      message: 'Объявление отправлено',
      donate: { ...donate, rankLabel: 'PREMIUM', remainingLabel: '30 дней' },
    });
    expect(root.querySelector('[data-donate-announce]')).toBe(field);
    expect(field.value).toBe('Привет сервер');
    expect(document.activeElement).toBe(field);
    expect(root.querySelector('[data-menu-message]')?.textContent).toBe('Объявление отправлено');
    expect(root.querySelector('[data-menu-screen="donate-announce"]')).toBeTruthy();
  });

  it('does not rewrite a field during IME composition', () => {
    const { root, ui } = mount();
    const base: ServerMenuMessage = {
      type: 'menu',
      screen: 'homes',
      title: 'Дома',
      homes: [],
      homeNameText: '',
      homeCount: 0,
      homeMax: 2,
    };
    ui.openGameMenu(base, { send() {}, close() {} });
    const input = root.querySelector<HTMLInputElement>('[data-menu-home-name]')!;
    typeInto(input, 'до');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    ui.applyGameMenu({
      ...base,
      homeNameText: '',
      homes: [{ name: 'А', x: 0, y: 0, z: 0 }],
      homeCount: 1,
      message: 'ошибка',
    });
    expect(root.querySelector('[data-menu-home-name]')).toBe(input);
    expect(input.value).toBe('до');
    expect(input.dataset.composing).toBe('1');
    expect(root.querySelector('.mc-menu-list')?.textContent).toContain('А');
  });
});

describe('auction, clan, and buyer patches', () => {
  it('shows a new lot under a focused search and drops the price draft on another lot', () => {
    const { root, ui } = mount();
    const sent: string[] = [];
    const browse = (patch: Partial<ServerAuctionMessage>): ServerAuctionMessage => ({
      type: 'auction',
      screen: 'browse',
      title: 'Аукцион',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      listings: [],
      ...patch,
    });
    ui.openAuction(browse({}), {
      send: (message) => sent.push(message.action),
      close() {},
    });
    const search = root.querySelector<HTMLInputElement>('[data-ah-search]')!;
    vi.useFakeTimers();
    typeInto(search, 'алмаз');
    vi.advanceTimersByTime(200);
    expect(sent.filter((action) => action === 'search')).toEqual(['search']);
    ui.applyAuction(browse({
      search: 'а',
      totalCount: 1,
      listings: [{
        listingId: 'lot-1',
        sellerName: 'Боб',
        sellerPlayerId: 'bob',
        price: 10,
        createdAt: 1,
        expiresAt: 2,
        remainingMs: 1,
        status: 'ACTIVE',
        item: { itemId: 'stone', count: 1 },
        itemName: 'Камень',
        tooltip: 'Камень',
      }],
      message: 'Обновлено',
    }));
    expect(root.querySelector('[data-ah-search]')).toBe(search);
    expect(search.value).toBe('алмаз');
    expect(root.querySelector('[data-ah-listing="lot-1"]')).toBeTruthy();
    expect(root.querySelector('[data-ah-message]')?.textContent).toBe('Обновлено');
    vi.advanceTimersByTime(200);
    expect(sent.filter((action) => action === 'search')).toEqual(['search']);
    vi.useRealTimers();

    ui.openAuction({
      type: 'auction',
      screen: 'sell-confirm',
      title: 'Продажа',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      listings: [],
      selected: { listingId: 'lot-a', priceText: '', amount: 1, maxAmount: 4, prompt: 'Лот A' },
    }, { send: (message) => sent.push(message.action), close() {} });
    const price = root.querySelector<HTMLInputElement>('[data-ah-price]')!;
    typeInto(price, '100', 3);
    ui.applyAuction({
      type: 'auction',
      screen: 'sell-confirm',
      title: 'Продажа',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      listings: [],
      message: 'Мало места',
      selected: { listingId: 'lot-a', priceText: '100', amount: 2, maxAmount: 4, prompt: 'Лот A' },
    });
    expect(root.querySelector('[data-ah-price]')).toBe(price);
    expect(price.value).toBe('100');
    expect(root.querySelector('[data-ah-message]')?.textContent).toBe('Мало места');
    ui.applyAuction({
      type: 'auction',
      screen: 'sell-confirm',
      title: 'Продажа',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      listings: [],
      selected: { listingId: 'lot-b', priceText: '5', amount: 1, maxAmount: 1, prompt: 'Лот B' },
    });
    const nextPrice = root.querySelector<HTMLInputElement>('[data-ah-price]');
    expect(nextPrice).not.toBe(price);
    expect(nextPrice!.value).toBe('5');
    expect(root.querySelector('[data-ah-screen="sell-confirm"]')?.getAttribute('data-ah-context')).toBe('lot-b');
  });

  it('updates a clan error around the name field and switches member context', () => {
    const { root, ui } = mount();
    const clan = (patch: Partial<ServerClanMessage>): ServerClanMessage => ({
      type: 'clan',
      screen: 'create',
      title: 'Клан',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      clans: [],
      ...patch,
    });
    ui.openClan(clan({}), { send() {}, close() {} });
    const name = root.querySelector<HTMLInputElement>('[data-clan-name]')!;
    typeInto(name, 'Волки');
    ui.applyClan(clan({
      message: 'Имя занято',
      create: { nameText: 'В', icon: 'swords', cost: 10000, costLabel: '10 000' },
    }));
    expect(root.querySelector('[data-clan-name]')).toBe(name);
    expect(name.value).toBe('Волки');
    expect(root.querySelector('[data-clan-message]')?.textContent).toBe('Имя занято');
  });

  it('updates buyer quantity around the price field and drops the draft for another npc', () => {
    const { root, ui } = mount();
    const buyer = (patch: Partial<ServerBuyerMessage>): ServerBuyerMessage => ({
      type: 'buyer',
      screen: 'admin',
      title: 'Скупщик',
      buyerId: 'npc-1',
      name: 'Фермер',
      hologramText: '',
      priceText: '1',
      quantity: 1,
      maxQuantity: 8,
      total: 1,
      totalLabel: '1',
      configured: true,
      ...patch,
    });
    ui.openBuyer(buyer({}), { send() {}, close() {} });
    const price = root.querySelector<HTMLInputElement>('[data-buyer-price]')!;
    typeInto(price, '12');
    ui.applyBuyer(buyer({
      priceText: '1',
      quantity: 4,
      totalLabel: '4',
      message: 'Сохранено',
      item: { itemId: 'stone', count: 1 },
    }));
    expect(root.querySelector('[data-buyer-price]')).toBe(price);
    expect(price.value).toBe('12');
    expect(root.querySelector('[data-buyer-item]')?.innerHTML).toContain('item:stone:1');
    expect(root.querySelector('[data-buyer-message]')?.textContent).toBe('Сохранено');
    ui.applyBuyer(buyer({ buyerId: 'npc-2', name: 'Мясник', priceText: '9' }));
    const next = root.querySelector<HTMLInputElement>('[data-buyer-price]');
    expect(next).not.toBe(price);
    expect(next!.value).toBe('9');
    expect(root.querySelector('[data-buyer-id]')?.getAttribute('data-buyer-id')).toBe('npc-2');
  });
});

describe('trade window patch', () => {
  it('keeps the money field while the partner offer, ready state, and buttons update', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-trade-ui-'));
    dirs.push(dir);
    const inventories = new Map<string, Inventory>([
      ['ada', new Inventory()],
      ['bob', new Inventory()],
    ]);
    inventories.get('bob')!.setSlot(0, createItemStack('stone', 3));
    const economy = new EconomyService(new JsonFileStore(dir));
    const trade = new TradeService(economy);
    trade.setRuntime({
      isOnline: () => true,
      displayName: (id) => (id === 'ada' ? 'Ada' : 'Bob'),
      lookupPlayer: (raw) => {
        const name = raw.trim().toLowerCase();
        if (name === 'ada') return { id: 'ada', name: 'Ada', connected: true };
        if (name === 'bob') return { id: 'bob', name: 'Bob', connected: true };
        return undefined;
      },
      inventory: (id) => inventories.get(id),
      balance: (id) => economy.getBalance(id),
      sendMessage: () => undefined,
    });
    expect(trade.request('ada', 'Bob').ok).toBe(true);
    expect(trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId).ok).toBe(true);

    const adaRoot = document.createElement('div');
    const bobRoot = document.createElement('div');
    document.body.append(adaRoot, bobRoot);
    const adaUi = new GameUI(adaRoot);
    const bobUi = new GameUI(bobRoot);
    sessions.push(adaUi, bobUi);
    const adaSent: ClientTradeActionMessage[] = [];
    const bobSent: ClientTradeActionMessage[] = [];
    const adaView = () => buildTradeMessage(trade, 'ada', inventories.get('ada')!.slots);
    const bobView = () => buildTradeMessage(trade, 'bob', inventories.get('bob')!.slots);
    adaUi.openTrade(adaView(), { send: (message) => adaSent.push(message), close() {} });
    bobUi.openTrade(bobView(), { send: (message) => bobSent.push(message), close() {} });

    const money = adaRoot.querySelector<HTMLInputElement>('[data-trade-money]')!;
    typeInto(money, '100', 3);
    expect(adaSent.map((message) => message.action)).toEqual(['set_money']);
    expect(trade.putItem('bob', 0, 0).ok).toBe(true);
    adaUi.applyTrade(adaView());
    bobUi.applyTrade(bobView());
    expect(adaRoot.querySelector('[data-trade-money]')).toBe(money);
    expect(money.value).toBe('100');
    expect(money.selectionStart).toBe(3);
    expect(adaRoot.querySelector('[data-trade-partner]')?.textContent).toContain('3');
    expect(bobRoot.querySelector('[data-trade-self]')?.textContent).toContain('3');
    expect(adaSent).toHaveLength(1);

    expect(trade.setMoney('bob', 40).ok).toBe(true);
    adaUi.applyTrade(adaView());
    expect(adaRoot.querySelector('[data-trade-money]')).toBe(money);
    expect(money.value).toBe('100');
    expect(adaRoot.querySelector('[data-trade-partner-money]')?.textContent).toContain('40');

    expect(trade.ready('bob').ok).toBe(true);
    adaUi.applyTrade(adaView());
    const accept = adaRoot.querySelector<HTMLButtonElement>('[data-trade-action="accept"]')!;
    expect(adaRoot.querySelector('.mc-trade-ready')?.textContent).toContain('Партнёр готов');
    expect(accept.disabled).toBe(true);
    expect(trade.ready('ada').ok).toBe(true);
    adaUi.applyTrade(adaView());
    expect(adaRoot.querySelector('[data-trade-money]')).toBe(money);
    expect(accept.disabled).toBe(false);

    for (let step = 0; step < 4; step += 1) adaUi.applyTrade(adaView());
    adaRoot.querySelector<HTMLButtonElement>('[data-trade-action="ready"]')!.click();
    expect(adaSent.filter((message) => message.action === 'ready')).toHaveLength(1);
    expect(adaSent.filter((message) => message.action === 'set_money')).toHaveLength(1);

    adaUi.applyTrade({ type: 'trade', screen: 'closed', title: '' });
    expect(adaRoot.querySelector('[data-trade-money]')).toBeNull();
    expect(adaSent.filter((message) => message.action === 'cancel' || message.action === 'close')).toHaveLength(0);
    expect(document.activeElement).not.toBe(money);
  });

  it('replaces a rejected money draft with the server amount and still shows the error', () => {
    const { root, ui } = mount();
    const sent: ClientTradeActionMessage[] = [];
    const base: ServerTradeMessage = {
      type: 'trade',
      screen: 'session',
      title: 'Обмен',
      tradeId: 't1',
      partnerId: 'bob',
      partnerName: 'Боб',
      moneyText: '10',
      partnerMoneyText: '0',
      selfReady: false,
      partnerReady: false,
      bothReady: false,
    };
    ui.openTrade(base, { send: (message) => sent.push(message), close() {} });
    const money = root.querySelector<HTMLInputElement>('[data-trade-money]')!;
    typeInto(money, '100');
    ui.applyTrade({ ...base, moneyText: '10', message: TRADE_MONEY_ERROR });
    expect(root.querySelector('[data-trade-money]')).toBe(money);
    expect(money.value).toBe('10');
    expect(root.querySelector('[data-trade-message]')?.textContent).toBe(TRADE_MONEY_ERROR);
    expect(sent.filter((message) => message.action === 'set_money')).toHaveLength(1);
  });
});

describe('donate resize', () => {
  it('keeps the announcement field when the viewport changes', () => {
    const { root, ui } = mount();
    const donate = {
      rankLabel: 'TITAN',
      summary: '',
      remainingLabel: 'навсегда',
      perks: [],
      actions: [{ id: 'announce', label: 'Объявление', available: true, detail: 'Раз в час', screen: 'donate-announce' as const }],
      kits: [],
      catalog: [],
      nickChoices: [],
      previewName: 'Ada',
      onlinePlayers: [],
      showInvseeOp: false,
    };
    ui.openGameMenu({ type: 'menu', screen: 'donate-announce', title: 'Донат', donate }, { send() {}, close() {} });
    const field = root.querySelector<HTMLTextAreaElement>('[data-donate-announce]');
    expect(root.querySelector('[data-menu-screen]')?.getAttribute('data-menu-screen'), root.innerHTML).toBe('donate-announce');
    if (!field) throw new Error('announce field missing');
    typeInto(field, 'жирный текст');
    const stage = root.querySelector<HTMLElement>('.mc-stage')!;
    const setViewport = (width: number, height: number): void => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: { width, height, offsetTop: 0, offsetLeft: 0 },
      });
      ui.relayoutOpenOverlays();
    };
    setViewport(844, 390);
    setViewport(667, 375);
    setViewport(932, 430);
    expect(root.querySelector('[data-donate-announce]')).toBe(field);
    expect(field.value).toBe('жирный текст');
    expect(root.querySelector('[data-menu-screen="donate-announce"]')).toBeTruthy();
    expect(stage.style.getPropertyValue('--mc-ui-scale')).toBe('1');
    expect(Number(stage.style.getPropertyValue('--mc-logical-width'))).toBeLessThanOrEqual(440);
  });
});
