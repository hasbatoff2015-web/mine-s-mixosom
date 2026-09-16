import { GAME_MENU_BUTTONS, showsMenuBack } from '../../shared/gameMenu';
import { FRIENDS_MAX } from '../../shared/friends';
import { formatMegacoinAmount } from '../../shared/megacoins';
import type { ServerMenuMessage } from '../../shared/protocol';

const MENU_SPRITE_FILES = {
  '--mc-menu-close': 'close.png',
  '--mc-menu-close-hover': 'close_hover.png',
  '--mc-menu-close-pressed': 'close_pressed.png',
  '--mc-menu-back': 'back.png',
  '--mc-menu-back-hover': 'back_hover.png',
  '--mc-menu-back-pressed': 'back_pressed.png',
} as const;

const HUD_SPRITE_FILES = {
  '--hud-pause-img': 'pause.png',
  '--hud-pause-hover-img': 'pause_hover.png',
  '--hud-pause-pressed-img': 'pause_pressed.png',
  '--hud-chat-img': 'chat.png',
  '--hud-chat-hover-img': 'chat_hover.png',
  '--hud-chat-pressed-img': 'chat_pressed.png',
  '--hud-menu-img': 'menu.png',
  '--hud-menu-hover-img': 'menu_hover.png',
  '--hud-menu-pressed-img': 'menu_pressed.png',
} as const;

export function menuAssetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return `${base}ui/menu/${file}`;
}

function spriteStyle(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([name, file]) => `${name}:url('${menuAssetUrl(file)}')`)
    .join(';');
}

export function menuChromeStyle(): string {
  return spriteStyle(MENU_SPRITE_FILES);
}

export function hudChromeStyle(): string {
  return spriteStyle(HUD_SPRITE_FILES);
}

export function menuBackHtml(screen: ServerMenuMessage['screen']): string {
  if (!showsMenuBack(screen)) return '';
  return '<button type="button" class="mc-close mc-back" data-menu-action="back" aria-label="Назад">←</button>';
}

export function menuBalanceHtml(state?: Pick<ServerMenuMessage, 'balance' | 'balanceLabel'>): string {
  const amount = state?.balanceLabel ?? formatMegacoinAmount(state?.balance ?? 0);
  return `<div class="mc-menu-balance">
    <img class="mc-menu-coin" src="${menuAssetUrl('icon_coin.png')}" alt="" draggable="false" />
    <span>Баланс: ${escapeMenu(amount)} монет</span>
  </div>`;
}

function menuHeadingHtml(title: string): string {
  return `<div class="mc-menu-heading">${escapeMenu(title)}</div><div class="mc-menu-rule" aria-hidden="true"></div>`;
}

function menuTileHtml(button: (typeof GAME_MENU_BUTTONS)[number]): string {
  return `<button type="button" class="mc-menu-tile" data-menu-open="${button.id}">
    <img class="mc-menu-tile-icon" src="${menuAssetUrl(button.icon)}" alt="" draggable="false" />
    <span class="mc-menu-tile-label">${escapeMenu(button.label)}</span>
  </button>`;
}

export function menuRootHtml(state?: Pick<ServerMenuMessage, 'balance' | 'balanceLabel'>): string {
  const row1 = GAME_MENU_BUTTONS.slice(0, 4).map(menuTileHtml).join('');
  const row2 = GAME_MENU_BUTTONS.slice(4).map(menuTileHtml).join('');
  return `<div class="mc-menu-body mc-menu-root" data-menu-screen="root">
    ${menuHeadingHtml('Меню')}
    ${menuBalanceHtml(state)}
    <div class="mc-menu-grid">
      <div class="mc-menu-grid-row mc-menu-grid-row-4">${row1}</div>
      <div class="mc-menu-grid-row mc-menu-grid-row-3">${row2}</div>
    </div>
  </div>`;
}

export function menuHomesHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  if (state.screen === 'home-delete-confirm') {
    const name = state.pendingHomeName ?? '';
    return `<div class="mc-menu-body">
      ${menuHeadingHtml('Дома')}
      <p class="mc-ah-prompt">Вы уверены, что хотите удалить дом «${escape(name)}»?</p>
      <div class="mc-ah-actions">
        <button type="button" class="mc-ah-btn" data-menu-action="home_confirm_delete">Удалить</button>
        <button type="button" class="mc-ah-btn" data-menu-action="home_cancel_delete">Отмена</button>
      </div>
    </div>`;
  }
  const homes = (state.homes ?? []).map((home) => `
    <div class="mc-menu-row">
      <button type="button" class="mc-menu-row-main" data-menu-home="${escape(home.name)}">
        <strong>${escape(home.name)}</strong>
        <span>(${Math.round(home.x)}, ${Math.round(home.y)}, ${Math.round(home.z)})</span>
      </button>
      <button type="button" class="mc-menu-x" data-menu-home-delete="${escape(home.name)}" aria-label="Удалить">X</button>
    </div>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="homes">
    ${menuHeadingHtml('Дома')}
    <div class="mc-menu-add">
      <input data-menu-home-name type="text" maxlength="24" value="${escape(state.homeNameText ?? '')}" placeholder="Название дома" autocomplete="off" spellcheck="false" />
      <button type="button" class="mc-ah-btn" data-menu-action="home_create">Добавить</button>
    </div>
    <div class="mc-menu-count">Мои дома (${state.homeCount ?? 0}/${state.homeMax ?? 4}):</div>
    <div class="mc-menu-list">${homes || '<p class="mc-menu-empty">Нет домов.</p>'}</div>
    ${menuMessage(state.message, escape)}
  </div>`;
}

export function menuFriendsHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  if (state.screen === 'friend-delete-confirm') {
    const name = state.pendingFriendName ?? '';
    return `<div class="mc-menu-body">
      ${menuHeadingHtml('Друзья')}
      <p class="mc-ah-prompt">Вы уверены, что хотите удалить игрока «${escape(name)}»?</p>
      <div class="mc-ah-actions">
        <button type="button" class="mc-ah-btn" data-menu-action="friends_confirm_delete">Удалить</button>
        <button type="button" class="mc-ah-btn" data-menu-action="friends_cancel_delete">Отмена</button>
      </div>
    </div>`;
  }
  const allowed = state.allowFriendTeleport === true;
  const requests = (state.friendRequests ?? []).map((row) => `
    <div class="mc-menu-row">
      <span>${escape(row.name)}</span>
      <span class="mc-menu-row-actions">
        <button type="button" class="mc-ah-btn" data-menu-friend-accept="${escape(row.requestId ?? '')}">Добавить</button>
        <button type="button" class="mc-ah-btn" data-menu-friend-reject="${escape(row.requestId ?? '')}">Отклонить</button>
      </span>
    </div>`).join('');
  const friends = (state.friends ?? []).map((row) => {
    const status = row.online
      ? '<span class="mc-menu-online">Онлайн</span>'
      : '<span class="mc-menu-offline">Оффлайн</span>';
    const teleport = row.canTeleport
      ? `<button type="button" class="mc-ah-btn" data-menu-friend-tp="${escape(row.playerId)}">Телепортироваться</button>`
      : '';
    return `<div class="mc-menu-row">
      <span class="${row.online ? 'mc-menu-online' : 'mc-menu-offline'}">${escape(row.name)} — ${status}</span>
      <span class="mc-menu-row-actions">
        ${teleport}
        <button type="button" class="mc-menu-x" data-menu-friend-delete="${escape(row.playerId)}" aria-label="Удалить">X</button>
      </span>
    </div>`;
  }).join('');
  return `<div class="mc-menu-body" data-menu-screen="friends">
    ${menuHeadingHtml('Друзья')}
    <div class="mc-menu-toggle">Телепортация друзей ко мне: <strong>${allowed ? 'Разрешена' : 'Запрещена'}</strong>
      <button type="button" class="mc-ah-btn" data-menu-tp="${allowed ? 'off' : 'on'}">${allowed ? 'Выключить' : 'Включить'}</button>
    </div>
    <div class="mc-menu-count">Заявки в друзья</div>
    <div class="mc-menu-list">${requests || '<p class="mc-menu-empty">Нет заявок.</p>'}</div>
    <div class="mc-menu-add">
      <input data-menu-friend-name type="text" maxlength="24" value="${escape(state.friendNameText ?? '')}" placeholder="Ник игрока" autocomplete="off" spellcheck="false" />
      <button type="button" class="mc-ah-btn" data-menu-action="friends_request">Отправить</button>
    </div>
    <div class="mc-menu-count">Мои друзья (${state.friendCount ?? 0}/${state.friendMax ?? FRIENDS_MAX}):</div>
    <div class="mc-menu-list">${friends || '<p class="mc-menu-empty">Нет друзей.</p>'}</div>
    ${menuMessage(state.message, escape)}
  </div>`;
}

export function menuClansHtml(state: ServerMenuMessage): string {
  const mineDisabled = state.inClan ? '' : ' disabled';
  return `<div class="mc-menu-body" data-menu-screen="clans">
    ${menuHeadingHtml('Кланы')}
    <div class="mc-ah-actions">
      <button type="button" class="mc-ah-btn" data-menu-action="clans_mine"${mineDisabled}>Мой клан</button>
      <button type="button" class="mc-ah-btn" data-menu-action="clans_list">Список кланов</button>
      <button type="button" class="mc-ah-btn" data-menu-action="clans_create">Создать клан</button>
    </div>
    ${menuMessage(state.message, (value) => value)}
  </div>`;
}

export function menuClaimsHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  if (state.screen === 'claim-delete-confirm') {
    const name = state.pendingClaimName ?? '';
    return `<div class="mc-menu-body">
      ${menuHeadingHtml('Приваты')}
      <p class="mc-ah-prompt">Вы уверены, что хотите удалить приват «${escape(name)}»?</p>
      <div class="mc-ah-actions">
        <button type="button" class="mc-ah-btn" data-menu-action="claim_confirm_delete">Удалить</button>
        <button type="button" class="mc-ah-btn" data-menu-action="claim_cancel_delete">Отмена</button>
      </div>
    </div>`;
  }
  if (state.screen === 'claim-settings') {
    const pvp = state.claimPvp === true;
    const members = (state.claimMembers ?? []).map((member) => `
      <div class="mc-menu-row">
        <span>${escape(member.name)}</span>
        <button type="button" class="mc-menu-x" data-menu-claim-kick="${escape(member.name)}" aria-label="Удалить">X</button>
      </div>`).join('');
    return `<div class="mc-menu-body" data-menu-screen="claim-settings">
      ${menuHeadingHtml('Приват')}
      <div class="mc-menu-add">
        <input data-menu-claim-name type="text" maxlength="24" value="${escape(state.claimNameText ?? '')}" placeholder="Название привата" autocomplete="off" spellcheck="false" />
        <button type="button" class="mc-ah-btn" data-menu-action="claim_rename">Сохранить</button>
      </div>
      <div class="mc-menu-toggle">PVP в привате: <strong>${pvp ? 'Включено' : 'Выключено'}</strong>
        <button type="button" class="mc-ah-btn" data-menu-claim-pvp="${pvp ? 'off' : 'on'}">${pvp ? 'Выключить' : 'Включить'}</button>
      </div>
      <div class="mc-menu-count">Игроки:</div>
      <div class="mc-menu-list">${members || '<p class="mc-menu-empty">Нет игроков.</p>'}</div>
      <div class="mc-menu-add">
        <input data-menu-claim-member type="text" maxlength="24" value="${escape(state.claimMemberText ?? '')}" placeholder="Ник игрока" autocomplete="off" spellcheck="false" />
        <button type="button" class="mc-ah-btn" data-menu-action="claim_add_member">Добавить</button>
      </div>
      <div class="mc-ah-actions">
        <button type="button" class="mc-ah-btn" data-menu-action="claim_delete">Удалить приват</button>
      </div>
      ${menuMessage(state.message, escape)}
    </div>`;
  }
  const claims = (state.claims ?? []).map((claim) => `
    <button type="button" class="mc-menu-row mc-menu-row-main" data-menu-claim="${escape(claim.claimId)}">
      <strong>${escape(claim.title)}</strong>
      <span>(${claim.x}, ${claim.y}, ${claim.z})</span>
    </button>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="claims">
    ${menuHeadingHtml('Приваты')}
    <div class="mc-menu-count">Ваши приваты (${state.claimCount ?? 0}/${state.claimMax ?? 4}):</div>
    <div class="mc-menu-list">${claims || '<p class="mc-menu-empty">Нет приватов.</p>'}</div>
    ${menuMessage(state.message, escape)}
  </div>`;
}

export function menuTradeLobbyHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  const incoming = (state.tradeIncoming ?? []).map((row) => `
    <div class="mc-menu-row">
      <span>${escape(row.name)}</span>
      <span class="mc-menu-row-actions">
        <button type="button" class="mc-ah-btn" data-menu-trade-accept="${escape(row.requestId ?? '')}">Принять</button>
        <button type="button" class="mc-ah-btn" data-menu-trade-reject="${escape(row.requestId ?? '')}">Отклонить</button>
      </span>
    </div>`).join('');
  const outgoing = (state.tradeOutgoing ?? []).map((row) => `
    <div class="mc-menu-row"><span>${escape(row.name)}</span></div>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="trade">
    ${menuHeadingHtml('Обмен')}
    <div class="mc-menu-count">Вам предлагают обмен:</div>
    <div class="mc-menu-list">${incoming || '<p class="mc-menu-empty">Нет предложений.</p>'}</div>
    <div class="mc-menu-count">Запросы на обмен:</div>
    <div class="mc-menu-list">${outgoing || '<p class="mc-menu-empty">Нет запросов.</p>'}</div>
    <div class="mc-menu-add">
      <input data-menu-trade-name type="text" maxlength="24" value="${escape(state.tradeNameText ?? '')}" placeholder="Ник игрока" autocomplete="off" spellcheck="false" />
      <button type="button" class="mc-ah-btn" data-menu-action="trade_request">Обмен</button>
    </div>
    ${menuMessage(state.message, escape)}
  </div>`;
}

export function menuAuctionHtml(): string {
  return `<div class="mc-menu-body" data-menu-screen="auction">
    ${menuHeadingHtml('Аукцион')}
    <div class="mc-ah-actions">
      <button type="button" class="mc-ah-btn" data-menu-action="auction_open">Открыть аукцион</button>
      <button type="button" class="mc-ah-btn" data-menu-action="auction_list">Мои предметы на аукционе</button>
      <button type="button" class="mc-ah-btn" data-menu-action="auction_sell">Выставить предметы на аукцион</button>
    </div>
  </div>`;
}

export function menuBodyHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  if (state.screen === 'homes' || state.screen === 'home-delete-confirm') return menuHomesHtml(state, escape);
  if (state.screen === 'friends' || state.screen === 'friend-delete-confirm') return menuFriendsHtml(state, escape);
  if (state.screen === 'clans') return menuClansHtml(state);
  if (state.screen === 'claims' || state.screen === 'claim-settings' || state.screen === 'claim-delete-confirm') {
    return menuClaimsHtml(state, escape);
  }
  if (state.screen === 'trade') return menuTradeLobbyHtml(state, escape);
  if (state.screen === 'auction') return menuAuctionHtml();
  return menuRootHtml(state);
}

function menuMessage(message: string | undefined, escape: (value: string) => string): string {
  return `<div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message ?? '')}</div>`;
}

function escapeMenu(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
