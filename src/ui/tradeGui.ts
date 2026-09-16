import { TRADE_SLOT_COUNT } from '../../shared/trade';
import type { ServerTradeMessage } from '../../shared/protocol';

export function tradeReadyLabel(selfReady: boolean | undefined, partnerReady: boolean | undefined): string {
  const self = selfReady ? 'Вы готовы' : 'Вы не готовы';
  const partner = partnerReady ? 'Партнёр готов' : 'Партнёр не готов';
  return `${self}<br>${partner}`;
}

export function tradeAcceptEnabled(state: Pick<ServerTradeMessage, 'bothReady' | 'selfAccepted' | 'partnerAccepted'>): boolean {
  return state.bothReady === true && state.selfAccepted !== true;
}

export function tradeSlotCount(): number {
  return TRADE_SLOT_COUNT;
}

export function tradeWindowChrome(state: ServerTradeMessage, escape: (value: string) => string, slots: {
  self: string;
  partner: string;
  inventory: string;
}): string {
  const acceptDisabled = tradeAcceptEnabled(state) ? '' : ' disabled';
  return `<div class="mc-menu-body mc-trade-body" data-trade-screen="session">
    <div class="mc-label">Обмен с ${escape(state.partnerName ?? 'игроком')}</div>
    <div class="mc-trade-boards">
      <div>
        <div class="mc-menu-count">Вы отдаёте</div>
        <div class="mc-trade-grid" data-trade-self>${slots.self}</div>
      </div>
      <div class="mc-trade-swap">↔</div>
      <div>
        <div class="mc-menu-count">${escape(state.partnerName ?? 'Игрок')}</div>
        <div class="mc-trade-grid" data-trade-partner>${slots.partner}</div>
      </div>
    </div>
    <label class="mc-ah-field">Монет
      <input data-trade-money type="text" inputmode="numeric" maxlength="9" value="${escape(state.moneyText ?? '0')}" autocomplete="off" spellcheck="false" />
    </label>
    <p class="mc-trade-ready">${tradeReadyLabel(state.selfReady, state.partnerReady)}</p>
    <div class="mc-ah-actions">
      <button type="button" class="mc-ah-btn" data-trade-action="ready">Готов</button>
      <button type="button" class="mc-ah-btn" data-trade-action="accept"${acceptDisabled}>Принять обмен</button>
      <button type="button" class="mc-ah-btn" data-trade-action="cancel">Отклонить</button>
    </div>
    ${slots.inventory}
    <div class="mc-ah-message" data-trade-message${state.message ? '' : ' hidden'}>${escape(state.message ?? '')}</div>
  </div>`;
}
