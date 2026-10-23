import { DONATION_COLORS, isDonationColorId } from '../../shared/donationRanks';
import type { NetworkDonateAction, NetworkDonateMenu, ServerMenuMessage } from '../../shared/protocol';

function colorHex(id: string | undefined): string {
  if (id && isDonationColorId(id)) return DONATION_COLORS[id];
  return '#f4f4f4';
}

function card(action: NetworkDonateAction, escape: (value: string) => string): string {
  const locked = action.available ? '' : ' is-locked';
  const active = action.available && action.active ? ' is-set' : '';
  const disabled = action.available ? '' : ' disabled';
  const open = action.id === 'ec'
    ? 'data-menu-action="donate_ec"'
    : action.screen
      ? `data-menu-open="${action.screen}"`
      : 'disabled';
  return `<button type="button" class="mc-donate-card${locked}${active}" ${open}${disabled}>
    <strong>${escape(action.label)}</strong>
    <span>${escape(action.detail)}</span>
  </button>`;
}

function messageHtml(message: string, escape: (value: string) => string): string {
  return `<div class="mc-ah-message" data-menu-message${message ? '' : ' hidden'}>${escape(message)}</div>`;
}

function shell(screen: string, title: string, body: string): string {
  return `<div class="mc-menu-body mc-donate" data-menu-screen="${screen}">
    <div class="mc-menu-heading">${title}</div>
    ${body}
  </div>`;
}

export function menuDonateHtml(state: ServerMenuMessage, escape: (value: string) => string): string {
  const donate = state.donate;
  const message = state.message ?? '';
  if (!donate) {
    return shell('donate', 'Донат', `
      <p class="mc-menu-empty">Не удалось загрузить привилегию.</p>
      <button type="button" class="mc-ah-btn" data-menu-action="donate_retry">Повторить</button>`);
  }
  if (state.screen === 'donate-color') return colorScreen(donate, message, escape);
  if (state.screen === 'donate-announce') return announceScreen(donate, message, escape);
  if (state.screen === 'donate-invsee') return invseeScreen(donate, message, escape, 'view');
  if (state.screen === 'donate-invsee-op') return invseeScreen(donate, message, escape, 'edit');
  if (state.screen === 'donate-tp') return teleportScreen(donate, message, escape);
  if (state.screen === 'donate-back') return backScreen(donate, message, escape);
  if (state.screen === 'donate-kits') return kitsScreen(donate, message, escape);
  if (state.screen === 'donate-pets') return petsScreen(donate, message, escape);
  return overview(donate, message, escape);
}

function overview(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  if (donate.loadError) {
    return shell('donate', 'Донат', `
      <p class="mc-menu-empty">${escape(donate.loadError)}</p>
      <button type="button" class="mc-ah-btn" data-menu-action="donate_retry">Повторить</button>`);
  }
  const limits = donate.perks.map((perk) => `
    <span class="mc-donate-chip"><strong>${escape(perk.title)}</strong> ${escape(perk.detail)}</span>`).join('');
  const actions = donate.actions.map((action) => card(action, escape)).join('');
  return shell('donate', 'Донат', `
    <div class="mc-donate-rank">
      <strong>${escape(donate.rankLabel)}</strong>
      <span>${escape(donate.remainingLabel)}</span>
    </div>
    <div class="mc-donate-chips">${limits}</div>
    <div class="mc-duel-section-head"><span>Действия</span></div>
    <div class="mc-donate-grid">${actions}</div>
    ${messageHtml(message, escape)}`);
}

function locked(detail: string, escape: (value: string) => string): string {
  return `<p class="mc-menu-empty">${escape(detail)}</p>`;
}

function colorScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'nickcolor');
  if (!action?.available) return shell('donate-color', 'Цвет ника', locked(action?.detail ?? 'Доступно с привилегии PREMIUM', escape));
  const swatches = donate.nickChoices.map((id) => `
    <button type="button" class="mc-donate-swatch${donate.nickColor === id ? ' is-current' : ''}" data-donate-swatch="${escape(id)}" style="background:${colorHex(id)}" aria-label="${escape(id)}"></button>`).join('');
  return shell('donate-color', 'Цвет ника', `
    <p class="mc-donate-preview" data-donate-preview style="color:${colorHex(donate.nickColor)}">${escape(donate.previewName)}</p>
    <div class="mc-donate-swatches" data-donate-color-pick>${swatches}</div>
    <div class="mc-ah-actions">
      <button type="button" class="mc-ah-btn" data-menu-action="donate_color">Применить</button>
      <button type="button" class="mc-ah-btn mc-btn-danger" data-menu-action="donate_color" data-donate-color="reset">Сбросить</button>
    </div>
    ${messageHtml(message, escape)}`);
}

function announceScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'announce');
  if (!action?.available) return shell('donate-announce', 'Объявление', locked(action?.detail ?? 'Доступно с привилегии PREMIUM', escape));
  return shell('donate-announce', 'Объявление', `
    <p class="mc-player-meta">${escape(action.detail)}</p>
    <textarea data-donate-field data-donate-announce maxlength="120" placeholder="Текст объявления"></textarea>
    <button type="button" class="mc-ah-btn" data-menu-action="donate_announce">Отправить</button>
    ${messageHtml(message, escape)}`);
}

function invseeScreen(
  donate: NetworkDonateMenu,
  message: string,
  escape: (value: string) => string,
  mode: 'view' | 'edit',
): string {
  const action = donate.actions.find((entry) => entry.id === (mode === 'edit' ? 'invseeop' : 'invsee'));
  const allowed = mode === 'edit' ? donate.showInvseeOp : action?.available === true;
  const title = mode === 'edit' ? 'Изменить чужой инвентарь' : 'Посмотреть чужой инвентарь';
  if (!allowed) return shell(mode === 'edit' ? 'donate-invsee-op' : 'donate-invsee', title, locked(action?.detail ?? 'Недоступно', escape));
  const rows = donate.onlinePlayers.map((player) => `
    <div class="mc-player-row" data-donate-player-row="${escape(player.name)}">
      <strong class="mc-player-name">${escape(player.name)}</strong>
      <button type="button" class="mc-ah-btn" data-menu-action="${mode === 'edit' ? 'donate_invseeop' : 'donate_invsee'}" data-donate-player="${escape(player.name)}">${mode === 'edit' ? 'Изменить' : 'Смотреть'}</button>
    </div>`).join('');
  return shell(mode === 'edit' ? 'donate-invsee-op' : 'donate-invsee', title, `
    <p class="mc-player-meta">${escape(action?.detail ?? (mode === 'edit' ? 'Только для OP' : 'Только просмотр'))}</p>
    <input data-donate-field data-donate-search type="text" maxlength="13" placeholder="Ник игрока" autocomplete="off" spellcheck="false" />
    <div class="mc-menu-list" data-donate-player-list>${rows || '<p class="mc-menu-empty">Никого нет онлайн.</p>'}</div>
    <p class="mc-menu-empty" data-donate-search-empty hidden>Никого с таким ником нет онлайн.</p>
    ${messageHtml(message, escape)}`);
}

function teleportScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'tp');
  if (!action?.available) return shell('donate-tp', 'Телепорт', locked(action?.detail ?? 'Доступно с привилегии TITAN', escape));
  return shell('donate-tp', 'Телепорт', `
    <p class="mc-player-meta">${escape(action.detail)}</p>
    <div class="mc-donate-coords">
      <input data-donate-field data-donate-x type="number" inputmode="decimal" placeholder="X" />
      <input data-donate-field data-donate-y type="number" inputmode="decimal" placeholder="Y" />
      <input data-donate-field data-donate-z type="number" inputmode="decimal" placeholder="Z" />
    </div>
    <button type="button" class="mc-ah-btn" data-menu-action="donate_tp">Телепортироваться</button>
    ${messageHtml(message, escape)}`);
}

function backScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const action = donate.actions.find((entry) => entry.id === 'back');
  const point = donate.deathPoint;
  if (!action?.available) return shell('donate-back', 'Смерть', locked(action?.detail ?? 'Возврат недоступен', escape));
  if (!point) return shell('donate-back', 'Смерть', '<p class="mc-menu-empty">Точка смерти не сохранена.</p>');
  return shell('donate-back', 'Смерть', `
    <p class="mc-player-meta">Последняя смерть: X ${Math.round(point.x)}, Y ${Math.round(point.y)}, Z ${Math.round(point.z)}.</p>
    <p class="mc-player-meta">${escape(action.detail)}</p>
    <button type="button" class="mc-ah-btn" data-menu-action="donate_back">Вернуться</button>
    ${messageHtml(message, escape)}`);
}

function petsScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const cards = (donate.pets ?? []).map((pet) => {
    const tone = pet.available ? (pet.summoned ? ' is-dismiss' : ' is-summon') : ' is-locked';
    const action = pet.available ? (pet.actionLabel ?? pet.label) : pet.detail;
    return `
    <button type="button" class="mc-donate-card${tone}" data-menu-action="donate_pet" data-donate-pet="${escape(pet.id)}" title="${escape(pet.detail)}"${pet.available ? '' : ' disabled'}>
      <strong>${escape(pet.label)}</strong>
      <span>${escape(action)}</span>
    </button>`;
  }).join('');
  return shell('donate-pets', 'Питомцы', `
    <div class="mc-donate-grid">${cards || '<p class="mc-menu-empty">Питомцев нет.</p>'}</div>
    ${messageHtml(message, escape)}`);
}

function kitsScreen(donate: NetworkDonateMenu, message: string, escape: (value: string) => string): string {
  const cards = donate.kits.map((kit) => `
    <button type="button" class="mc-donate-card${kit.available ? '' : ' is-locked'}" data-menu-action="donate_kit" data-donate-kit="${escape(kit.name)}" title="${escape(kit.detail)}"${kit.available ? '' : ' disabled'}>
      <strong>${escape(kit.label)}</strong>
      <span>${escape(kit.detail)}</span>
    </button>`).join('');
  return shell('donate-kits', 'Наборы', `
    <div class="mc-donate-grid">${cards || '<p class="mc-menu-empty">Наборов нет.</p>'}</div>
    ${messageHtml(message, escape)}`);
}
