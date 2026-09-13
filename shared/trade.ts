export const TRADE_PLUGIN_NAME = 'trade';
export const TRADE_SLOT_COUNT = 6;
export const TRADE_SLOT_COLUMNS = 3;
export const TRADE_SLOT_ROWS = 2;

export const TRADE_SELF_ERROR = 'Нельзя отправить обмен самому себе.';
export const TRADE_MISSING_PLAYER_ERROR = 'Игрок не найден.';
export const TRADE_OFFLINE_ERROR = 'Игрок не в сети.';
export const TRADE_BUSY_ERROR = 'Этот игрок уже участвует в обмене.';
export const TRADE_ALREADY_REQUEST_ERROR = 'Запрос на обмен уже отправлен.';
export const TRADE_MISSING_ERROR = 'Обмен не найден.';
export const TRADE_NOT_READY_ERROR = 'Сначала оба игрока должны нажать «Готов».';
export const TRADE_MONEY_ERROR = 'Некорректная сумма Мегакоинов.';
export const TRADE_MONEY_BALANCE_ERROR = 'Недостаточно Мегакоинов.';
export const TRADE_ITEM_ERROR = 'Предмет больше недоступен для обмена.';
export const TRADE_STACK_ERROR = 'Нельзя положить больше предметов, чем есть в стаке.';
export const TRADE_CHANGED_ERROR = 'Предложение изменилось. Подтвердите обмен заново.';
export const TRADE_SPACE_ERROR = 'Недостаточно места в инвентаре для обмена';
export const TRADE_ATOMIC_ERROR = 'Не удалось провести обмен. Ничего не изменено.';
export const TRADE_CANCELLED_MESSAGE = 'Обмен отменён.';

export function tradeSpaceError(name: string): string {
  return `У ${name} недостаточно места в инвентаре для обмена`;
}

export function isTradeSlotIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < TRADE_SLOT_COUNT;
}
