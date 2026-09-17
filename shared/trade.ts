import { NEARBY_CHAT_RADIUS } from './chat';

export const TRADE_PLUGIN_NAME = 'trade';
export const TRADE_SLOT_COUNT = 6;
/** Inclusive 3D radius for the trade lobby nearby list. Same as Nearby chat. */
export const TRADE_NEARBY_RADIUS = NEARBY_CHAT_RADIUS;
export const TRADE_NEARBY_EMPTY = 'Обмениваться можно только с игроками, которые находятся рядом с вами (до 20 блоков).';
export const TRADE_SELF_ERROR = 'Нельзя обмениваться с самим собой.';
export const TRADE_UNKNOWN_ERROR = 'Игрок с таким ником не найден.';
export const TRADE_OFFLINE_ERROR = 'Игрок не в сети.';
export const TRADE_EMPTY_NAME_ERROR = 'Введите ник игрока.';
export const TRADE_BUSY_ERROR = 'Обмен уже идёт.';
export const TRADE_DUPLICATE_REQUEST_ERROR = 'Запрос на обмен этому игроку уже отправлен.';
export const TRADE_REQUEST_MISSING_ERROR = 'Предложение обмена не найдено.';
export const TRADE_STALE_ERROR = 'Обмен устарел.';
export const TRADE_NOT_READY_ERROR = 'Оба игрока должны нажать «Готов».';
export const TRADE_MONEY_ERROR = 'Количество монет должно быть целым и не больше вашего баланса.';
export const TRADE_STACK_ERROR = 'Нельзя положить больше, чем позволяет стопка.';
export const TRADE_ITEM_MISSING_ERROR = 'Предмет больше не находится в инвентаре.';
export const TRADE_CANCELLED_MESSAGE = 'Обмен отклонён.';

export function tradeInventoryFullError(name: string): string {
  return `У ${name} недостаточно места в инвентаре для обмена`;
}

export type TradePhase = 'offer' | 'ready' | 'accepting';
