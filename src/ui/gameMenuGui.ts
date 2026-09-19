import { GAME_MENU_BUTTONS, showsMenuBack } from '../../shared/gameMenu';
import { FRIENDS_MAX } from '../../shared/friends';
import { HOME_MAX_DEFAULT } from '../../shared/homes';
import { formatMegacoinAmount } from '../../shared/megacoins';
import {
  formatNotificationBadge,
  notificationCategoryForButton,
  type NotificationCounts,
} from '../../shared/notifications';
import { AUCTION_HISTORY_EMPTY } from '../../shared/auctionHistory';
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

const CHAT_SPRITE_FILES = {
  '--chat-tab-global': 'tab_global.png',
  '--chat-tab-nearby': 'tab_nearby.png',
  '--chat-tab-clan': 'tab_clan.png',
  '--chat-close-img': 'close.png',
  '--chat-enter-img': 'enter.png',
  '--chat-on-img': 'on.png',
  '--chat-off-img': 'off.png',
} as const;

export function menuAssetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return `${base}ui/menu/${file}`;
}

export function chatAssetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return `${base}ui/chat/${file}`;
}

function spriteStyle(files: Record<string, string>, urlFor: (file: string) => string): string {
  return Object.entries(files)
    .map(([name, file]) => `${name}:url('${urlFor(file)}')`)
    .join(';');
}

export function menuChromeStyle(): string {
  return spriteStyle(MENU_SPRITE_FILES, menuAssetUrl);
}

export function overlayStageStyle(scale: number, logicalWidth: number): string {
  return `--mc-ui-scale:${scale}; --mc-logical-width:${logicalWidth}; ${menuChromeStyle()}`;
}

export function hudChromeStyle(): string {
  return spriteStyle(HUD_SPRITE_FILES, menuAssetUrl);
}

export function chatChromeStyle(): string {
  return spriteStyle(CHAT_SPRITE_FILES, chatAssetUrl);
}

export function menuBackHtml(screen: ServerMenuMessage['screen']): string {
  if (!showsMenuBack(screen)) return '';
  return '<button type="button" class="mc-close mc-back" data-menu-action="back" aria-label="Назад">←</button>';
}

export function menuBalanceHtml(state?: Pick<ServerMenuMessage, 'balance' | 'balanceLabel'>): string {
  const amount = state?.balanceLabel ?? formatMegacoinAmount(state?.balance ?? 0);
  return `<div class="mc-menu-balance">
    <span class="mc-menu-coin-wrap">
      <img class="mc-menu-coin" src="${menuAssetUrl('icon_coin.png')}" alt="" draggable="false" />
    </span>
    <span>Баланс: ${escapeMenu(amount)} монет</span>
  </div>`;
}

function menuHeadingHtml(title: string): string {
  return `<div class="mc-menu-heading">${escapeMenu(title)}</div><div class="mc-menu-rule" aria-hidden="true"></div>`;
}

function menuTileHtml(
  button: (typeof GAME_MENU_BUTTONS)[number],
  notifications?: Partial<NotificationCounts> | undefined,
): string {
  const category = notificationCategoryForButton(button.id);
  const badge = category ? formatNotificationBadge(notifications?.[category] ?? 0) : undefined;
  const badgeHtml = badge
    ? `<span class="mc-menu-badge" aria-hidden="true">${escapeMenu(badge)}</span>`
    : '';
  return `<button type="button" class="mc-menu-tile" data-menu-open="${button.id}">
    ${badgeHtml}
    <img class="mc-menu-tile-icon" src="${menuAssetUrl(button.icon)}" alt="" draggable="false" />
    <span class="mc-menu-tile-label">${escapeMenu(button.label)}</span>
  </button>`;
}

export function menuRootHtml(
  state?: Pick<ServerMenuMessage, 'balance' | 'balanceLabel' | 'notifications'>,
): string {
  const row1 = GAME_MENU_BUTTONS.slice(0, 4).map((button) => menuTileHtml(button, state?.notifications)).join('');
  const row2 = GAME_MENU_BUTTONS.slice(4).map((button) => menuTileHtml(button, state?.notifications)).join('');
  return `<div class="mc-menu-body mc-menu-root" data-menu-screen="root">
    ${menuHeadingHtml('Меню')}
    ${menuBalanceHtml(state)}
    <div class="mc-menu-grid">
      <div class="mc-menu-grid-row mc-menu-grid-row-4">${row1}</div>
      <div class="mc-menu-grid-row mc-menu-grid-row-4">${row2}</div>
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
    <div class="mc-player-row">
      <div class="mc-player-main">
        <strong class="mc-player-name">${escape(home.name)}</strong>
        <span class="mc-player-meta">X: ${Math.round(home.x)}&nbsp;&nbsp;Y: ${Math.round(home.y)}&nbsp;&nbsp;Z: ${Math.round(home.z)}</span>
      </div>
      <span class="mc-menu-row-actions">
        <button type="button" class="mc-ah-btn" data-menu-home="${escape(home.name)}">Телепорт</button>
        <button type="button" class="mc-ah-btn mc-btn-danger" data-menu-home-delete="${escape(home.name)}">Удалить</button>
      </span>
    </div>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="homes">
    ${menuHeadingHtml('Дома')}
    <div class="mc-menu-add">
      <input data-menu-home-name type="text" maxlength="24" value="${escape(state.homeNameText ?? '')}" placeholder="Название дома" autocomplete="off" spellcheck="false" />
      <button type="button" class="mc-ah-btn" data-menu-action="home_create">Добавить</button>
    </div>
    <div class="mc-menu-count">Мои дома (${state.homeCount ?? 0}/${state.homeMax ?? HOME_MAX_DEFAULT}):</div>
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
    <div class="mc-player-row">
      <div class="mc-player-main">
        <span class="mc-player-name">${escape(row.name)}</span>
      </div>
      <span class="mc-menu-row-actions">
        <button type="button" class="mc-ah-btn mc-btn-positive" data-menu-friend-accept="${escape(row.requestId ?? '')}">Добавить</button>
        <button type="button" class="mc-ah-btn mc-btn-danger" data-menu-friend-reject="${escape(row.requestId ?? '')}">Отклонить</button>
      </span>
    </div>`).join('');
  const friends = (state.friends ?? []).map((row) => {
    const teleport = row.canTeleport
      ? `<button type="button" class="mc-ah-btn" data-menu-friend-tp="${escape(row.playerId)}">Телепорт</button>`
      : '';
    return `<div class="mc-player-row">
      <span class="mc-status-dot ${row.online ? 'is-online' : 'is-offline'}" aria-hidden="true"></span>
      <div class="mc-player-main">
        <span class="mc-player-name ${row.online ? 'mc-menu-online' : 'mc-menu-offline'}">${escape(row.name)}</span>
        <span class="${row.online ? 'mc-menu-online' : 'mc-menu-offline'}">${row.online ? 'Онлайн' : 'Оффлайн'}</span>
      </div>
      <span class="mc-menu-row-actions">
        ${teleport}
        <button type="button" class="mc-ah-btn mc-btn-danger" data-menu-friend-delete="${escape(row.playerId)}">Удалить</button>
      </span>
    </div>`;
  }).join('');
  return `<div class="mc-menu-body" data-menu-screen="friends">
    ${menuHeadingHtml('Друзья')}
    <div class="mc-menu-toggle">
      <span>Телепортация друзей ко мне: <strong class="${allowed ? 'mc-menu-online' : 'mc-menu-offline'}">${allowed ? 'Разрешена' : 'Запрещена'}</strong></span>
      <button type="button" class="mc-toggle${allowed ? ' is-on' : ''}" data-menu-tp="${allowed ? 'off' : 'on'}" role="switch" aria-checked="${allowed ? 'true' : 'false'}" aria-label="Телепортация друзей ко мне">
        <span class="mc-toggle-knob" aria-hidden="true"></span>
      </button>
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
      <button type="button" class="mc-ah-btn" data-menu-action="clans_invitations">Приглашения</button>
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
      <div class="mc-player-row">
        <div class="mc-player-main"><span class="mc-player-name">${escape(member.name)}</span></div>
        <button type="button" class="mc-ah-btn mc-btn-danger" data-menu-claim-kick="${escape(member.name)}">Удалить</button>
      </div>`).join('');
    return `<div class="mc-menu-body" data-menu-screen="claim-settings">
      ${menuHeadingHtml('Приват')}
      <div class="mc-menu-add">
        <input data-menu-claim-name type="text" maxlength="24" value="${escape(state.claimNameText ?? '')}" placeholder="Название привата" autocomplete="off" spellcheck="false" />
        <button type="button" class="mc-ah-btn" data-menu-action="claim_rename">Сохранить</button>
      </div>
      <div class="mc-menu-toggle">
        <span>PVP в привате: <strong class="${pvp ? 'mc-menu-online' : 'mc-menu-offline'}">${pvp ? 'Включено' : 'Выключено'}</strong></span>
        <button type="button" class="mc-toggle${pvp ? ' is-on' : ''}" data-menu-claim-pvp="${pvp ? 'off' : 'on'}" role="switch" aria-checked="${pvp ? 'true' : 'false'}" aria-label="PVP в привате">
          <span class="mc-toggle-knob" aria-hidden="true"></span>
        </button>
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
    <button type="button" class="mc-player-row mc-player-row-button${state.claimId === claim.claimId ? ' is-selected' : ''}" data-menu-claim="${escape(claim.claimId)}">
      <div class="mc-player-main">
        <strong class="mc-player-name">${escape(claim.title)}</strong>
        <span class="mc-player-meta">X: ${claim.x}&nbsp;&nbsp;Y: ${claim.y}&nbsp;&nbsp;Z: ${claim.z}</span>
      </div>
    </button>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="claims">
    ${menuHeadingHtml('Приваты')}
    <div class="mc-menu-count">Ваши приваты (${state.claimCount ?? 0}/${state.claimMax ?? 4}):</div>
    <div class="mc-menu-list">${claims || '<p class="mc-menu-empty">Нет приватов.</p>'}</div>
    ${menuMessage(state.message, escape)}
  </div>`;
}

export function menuTradeLobbyHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  const nearby = (state.tradeNearby ?? []).map((row) => `
    <div class="mc-player-row">
      <span class="mc-status-dot is-online" aria-hidden="true"></span>
      <div class="mc-player-main">
        <span class="mc-player-name mc-menu-online">${escape(row.name)}</span>
      </div>
      <span class="mc-player-distance">${row.distance} бл.</span>
      <button type="button" class="mc-ah-btn" data-menu-trade-nearby="${escape(row.name)}">Обмен</button>
    </div>`).join('');
  const incoming = (state.tradeIncoming ?? []).map((row) => `
    <div class="mc-player-row">
      <div class="mc-player-main"><span class="mc-player-name">${escape(row.name)}</span></div>
      <span class="mc-menu-row-actions">
        <button type="button" class="mc-ah-btn mc-btn-positive" data-menu-trade-accept="${escape(row.requestId ?? '')}">Принять</button>
        <button type="button" class="mc-ah-btn mc-btn-danger" data-menu-trade-reject="${escape(row.requestId ?? '')}">Отклонить</button>
      </span>
    </div>`).join('');
  const outgoing = (state.tradeOutgoing ?? []).map((row) => `
    <div class="mc-player-row"><div class="mc-player-main"><span class="mc-player-name">${escape(row.name)}</span></div></div>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="trade">
    ${menuHeadingHtml('Обмен')}
    <div class="mc-section-head">
      <div class="mc-menu-count">Рядом</div>
      <button type="button" class="mc-ah-btn mc-btn-refresh" data-menu-action="trade_refresh" aria-label="Обновить">Обновить</button>
    </div>
    <div class="mc-menu-list">${nearby || '<p class="mc-menu-empty">Обмениваться можно только с игроками, которые находятся рядом с вами (до 20 блоков).</p>'}</div>
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
      <button type="button" class="mc-ah-btn" data-menu-action="auction_history">История сделок</button>
    </div>
  </div>`;
}

export function menuAuctionHistoryHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  const rows = (state.auctionHistory ?? []).map((row) => `
    <div class="mc-menu-history-row">
      <div class="mc-menu-history-title">${escape(row.title)}</div>
      <div class="mc-menu-history-ago">${escape(row.ago)}</div>
    </div>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="auction-history">
    ${menuHeadingHtml('История сделок')}
    <div class="mc-menu-list mc-menu-history">${rows || `<p class="mc-menu-empty">${AUCTION_HISTORY_EMPTY}</p>`}</div>
  </div>`;
}

function rankingSortBtn(kind: string, current: string | undefined, label: string): string {
  return `<button type="button" class="mc-ah-btn${current === kind ? ' is-on' : ''}" data-menu-rating="${kind}">${label}</button>`;
}

function rankingCoinHtml(): string {
  return `<span class="mc-menu-coin-wrap mc-rank-coin-wrap">
      <img class="mc-menu-coin" src="${menuAssetUrl('icon_coin.png')}" alt="" draggable="false" />
    </span>`;
}

function rankingValueHtml(
  row: { metric?: string; valueLabel: string },
  escape: (value: string) => string,
): string {
  if (row.metric === 'kills') {
    return `<span class="mc-rank-value mc-rank-kills">${escape(row.valueLabel)}</span>`;
  }
  return `<span class="mc-rank-value">${rankingCoinHtml()}<span>${escape(row.valueLabel)}</span></span>`;
}

export function menuRatingHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  const kind = state.ratingKind ?? 'players-money';
  const rows = (state.ratingRows ?? []).map((row) => {
    const highlight = row.highlight ? ' mc-rank-you' : '';
    return `<div class="mc-rank-row${highlight}">
      <span class="mc-rank-pos">${row.rank}.</span>
      <span class="mc-rank-name">${escape(row.name)}</span>
      ${rankingValueHtml(row, escape)}
    </div>`;
  }).join('');
  const page = state.ratingPage ?? 1;
  const totalPages = state.ratingTotalPages ?? 1;
  const personal = state.personalText
    ? `<div class="mc-rank-personal mc-rank-you">${escape(state.personalText)}</div>`
    : '';
  return `<div class="mc-menu-body" data-menu-screen="rating">
    ${menuHeadingHtml('Рейтинг')}
    <div class="mc-rank-groups">
      <div class="mc-rank-group">
        <div class="mc-rank-heading">Игроки</div>
        <div class="mc-ah-actions mc-rank-actions">
          ${rankingSortBtn('players-money', kind, 'По монетам')}
          ${rankingSortBtn('players-kills', kind, 'По убийствам')}
        </div>
      </div>
      <div class="mc-rank-group">
        <div class="mc-rank-heading">Кланы</div>
        <div class="mc-ah-actions mc-rank-actions">
          ${rankingSortBtn('clans-money', kind, 'По монетам')}
          ${rankingSortBtn('clans-kills', kind, 'По убийствам')}
        </div>
      </div>
    </div>
    <div class="mc-menu-list mc-rank-list">${rows || '<p class="mc-menu-empty">Пока нет записей.</p>'}</div>
    <div class="mc-ah-nav">
      <button type="button" class="mc-slot mc-ah-icon" data-menu-rating-page="prev" ${page <= 1 ? 'disabled' : ''}>←</button>
      <span class="mc-ah-page">Страница ${page} / ${totalPages}</span>
      <button type="button" class="mc-slot mc-ah-icon" data-menu-rating-page="next" ${page >= totalPages ? 'disabled' : ''}>→</button>
    </div>
    ${personal}
    ${menuMessage(state.message, escape)}
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
  if (state.screen === 'auction-history') return menuAuctionHistoryHtml(state, escape);
  if (state.screen === 'rating') return menuRatingHtml(state, escape);
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
