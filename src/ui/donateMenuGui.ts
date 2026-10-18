import { DONATION_COLORS, isDonationColorId } from '../../shared/donationRanks';
import type { NetworkDonateAction, NetworkDonateMenu, ServerMenuMessage } from '../../shared/protocol';

function colorHex(id: string | undefined): string {
  if (id && isDonationColorId(id)) return DONATION_COLORS[id];
  return '#f4f4f4';
}

function actionButton(action: NetworkDonateAction, escape: (value: string) => string): string {
  const disabled = action.available ? '' : ' disabled';
  if (action.id === 'ec') {
    return `<button type="button" class="mc-ah-btn" data-menu-action="donate_ec"${disabled}>${escape(action.label)}</button>`;
  }
  if (action.id === 'invseeop') {
    return `<button type="button" class="mc-ah-btn" data-menu-open="donate-invsee"${disabled}>${escape(action.label)}</button>`;
  }
  if (action.screen) {
    return `<button type="button" class="mc-ah-btn" data-menu-open="${action.screen}"${disabled}>${escape(action.label)}</button>`;
  }
  return `<button type="button" class="mc-ah-btn" disabled>${escape(action.label)}</button>`;
}

function overview(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  if (donate.loadError) {
    return `<div class="mc-menu-body" data-menu-screen="donate">
      <div class="mc-menu-heading">Донат</div>
      <p class="mc-menu-empty">${escape(donate.loadError)}</p>
      <button type="button" class="mc-ah-btn" data-menu-action="donate_retry">Повторить</button>
    </div>`;
  }
  const perks = donate.perks.map((perk) => `
    <div class="mc-donate-perk">
      <strong>${escape(perk.title)}</strong>
      <span>${escape(perk.detail)}</span>
    </div>`).join('');
  const actions = donate.actions.map((action) => `
    <div class="mc-donate-action">
      ${actionButton(action, escape)}
      <span>${escape(action.detail)}</span>
    </div>`).join('');
  const kits = donate.kits.map((kit) => `
    <div class="mc-donate-action">
      <button type="button" class="mc-ah-btn" data-menu-action="donate_kit" data-donate-kit="${escape(kit.name)}"${kit.available ? '' : ' disabled'}>${escape(kit.label)}</button>
      <span>${escape(kit.detail)}</span>
    </div>`).join('');
  const catalog = donate.catalog.length === 0 ? '' : `
    <div class="mc-duel-section-head"><span>Привилегии</span></div>
    ${donate.catalog.map((row) => `<p class="mc-player-meta"><strong>${escape(row.title)}.</strong> ${escape(row.detail)}</p>`).join('')}`;
  return `<div class="mc-menu-body" data-menu-screen="donate">
    <div class="mc-menu-heading">Донат</div>
    <div class="mc-donate-rank">
      <strong>${escape(donate.rankLabel)}</strong>
      <span>${escape(donate.remainingLabel)}</span>
    </div>
    <p class="mc-player-meta">${escape(donate.summary)}</p>
    <div class="mc-donate-perks">${perks}</div>
    ${catalog}
    <div class="mc-duel-section-head"><span>Действия</span></div>
    <div class="mc-donate-actions">${actions}</div>
    <div class="mc-duel-section-head"><span>Наборы</span></div>
    <div class="mc-donate-actions">${kits || '<p class="mc-menu-empty">Наборов нет.</p>'}</div>
    <div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>
  </div>`;
}

export function menuDonateHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  const donate = state.donate;
  const message = state.message ?? '';
  if (!donate) {
    return `<div class="mc-menu-body" data-menu-screen="donate">
      <div class="mc-menu-heading">Донат</div>
      <p class="mc-menu-empty">Не удалось загрузить привилегию.</p>
      <button type="button" class="mc-ah-btn" data-menu-action="donate_retry">Повторить</button>
    </div>`;
  }
  if (state.screen === 'donate-color') return colorScreen(donate, message, escape);
  if (state.screen === 'donate-announce') return announceScreen(donate, message, escape);
  if (state.screen === 'donate-invsee') return invseeScreen(donate, message, escape);
  if (state.screen === 'donate-tp') return teleportScreen(donate, message, escape);
  if (state.screen === 'donate-back') return backScreen(donate, message, escape);
  return overview(donate, message, escape);
}

function locked(detail: string, escape: (value: string) => string): string {
  return `<p class="mc-menu-empty">${escape(detail)}</p>`;
}

function colorScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'nickcolor');
  if (!action?.available) {
    return `<div class="mc-menu-body" data-menu-screen="donate-color">
      <div class="mc-menu-heading">Цвет ника</div>
      ${locked(action?.detail ?? 'Доступно с привилегии PREMIUM.', escape)}
    </div>`;
  }
  const swatches = donate.nickChoices.map((id) => `
    <button type="button" class="mc-donate-swatch${donate.nickColor === id ? ' is-current' : ''}" data-donate-swatch="${escape(id)}" style="background:${colorHex(id)}" aria-label="${escape(id)}"></button>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="donate-color" data-donate-color-pick>
    <div class="mc-menu-heading">Цвет ника</div>
    <p class="mc-donate-preview" data-donate-preview style="color:${colorHex(donate.nickColor)}">${escape(donate.previewName)}</p>
    <div class="mc-donate-swatches">${swatches}</div>
    <div class="mc-ah-actions">
      <button type="button" class="mc-ah-btn" data-menu-action="donate_color">Применить</button>
      <button type="button" class="mc-ah-btn" data-menu-action="donate_color" data-donate-color="reset">Сбросить</button>
    </div>
    <div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>
  </div>`;
}

function announceScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'announce');
  if (!action?.available) return `<div class="mc-menu-body"><div class="mc-menu-heading">Объявление</div>${locked(action?.detail ?? 'Доступно с привилегии PREMIUM.', escape)}</div>`;
  return `<div class="mc-menu-body" data-menu-screen="donate-announce">
    <div class="mc-menu-heading">Объявление</div>
    <p class="mc-player-meta">${escape(action.detail)}</p>
    <textarea data-donate-field data-donate-announce maxlength="120" placeholder="Текст объявления"></textarea>
    <button type="button" class="mc-ah-btn" data-menu-action="donate_announce">Отправить</button>
    <div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>
  </div>`;
}

function invseeScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'invsee');
  const canView = action?.available === true;
  const canEdit = donate.showInvseeOp;
  if (!canView && !canEdit) {
    return `<div class="mc-menu-body"><div class="mc-menu-heading">Инвентарь</div>${locked(action?.detail ?? 'Доступно с привилегии TITAN.', escape)}</div>`;
  }
  const rows = donate.onlinePlayers.map((player) => `
    <div class="mc-player-row">
      <strong class="mc-player-name">${escape(player.name)}</strong>
      <span class="mc-menu-row-actions">
        ${canView ? `<button type="button" class="mc-ah-btn" data-menu-action="donate_invsee" data-donate-player="${escape(player.name)}">Смотреть</button>` : ''}
        ${canEdit ? `<button type="button" class="mc-ah-btn" data-menu-action="donate_invseeop" data-donate-player="${escape(player.name)}">Изменить</button>` : ''}
      </span>
    </div>`).join('');
  return `<div class="mc-menu-body" data-menu-screen="donate-invsee">
    <div class="mc-menu-heading">Инвентарь</div>
    <p class="mc-player-meta">${escape(action?.detail ?? 'Только просмотр.')}</p>
    <div class="mc-menu-list">${rows || '<p class="mc-menu-empty">Никого нет онлайн.</p>'}</div>
    <div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>
  </div>`;
}

function teleportScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'tp');
  if (!action?.available) return `<div class="mc-menu-body"><div class="mc-menu-heading">Телепорт</div>${locked(action?.detail ?? 'Доступно с привилегии TITAN.', escape)}</div>`;
  return `<div class="mc-menu-body" data-menu-screen="donate-tp">
    <div class="mc-menu-heading">Телепорт</div>
    <p class="mc-player-meta">${escape(action.detail)}</p>
    <div class="mc-donate-coords">
      <input data-donate-field data-donate-x type="number" inputmode="decimal" placeholder="X" />
      <input data-donate-field data-donate-y type="number" inputmode="decimal" placeholder="Y" />
      <input data-donate-field data-donate-z type="number" inputmode="decimal" placeholder="Z" />
    </div>
    <button type="button" class="mc-ah-btn" data-menu-action="donate_tp">Телепортироваться</button>
    <div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>
  </div>`;
}

function backScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'back');
  const point = donate.deathPoint;
  if (!action?.available) return `<div class="mc-menu-body"><div class="mc-menu-heading">Смерть</div>${locked(action?.detail ?? 'Возврат недоступен.', escape)}</div>`;
  if (!point) {
    return `<div class="mc-menu-body" data-menu-screen="donate-back">
      <div class="mc-menu-heading">Смерть</div>
      <p class="mc-menu-empty">Точка смерти не сохранена.</p>
    </div>`;
  }
  return `<div class="mc-menu-body" data-menu-screen="donate-back">
    <div class="mc-menu-heading">Смерть</div>
    <p class="mc-player-meta">Перемещение на X ${Math.round(point.x)}, Y ${Math.round(point.y)}, Z ${Math.round(point.z)}.</p>
    <p class="mc-player-meta">${escape(action.detail)}</p>
    <button type="button" class="mc-ah-btn" data-menu-action="donate_back">Вернуться</button>
    <div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>
  </div>`;
}
