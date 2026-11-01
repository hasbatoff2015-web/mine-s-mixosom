import { randomUUID } from 'node:crypto';
import { parseUuid } from '../db/uuid';
import type { EconomyCommandRequest } from './currencyPort';

/** Shown when a client money mutation has no usable request UUID. */
export const MONEY_REQUEST_REQUIRED = 'Нужен идентификатор запроса.';

/**
 * A network money intent. Missing or non-UUID values are refused.
 * This does not invent an id for an untrusted packet.
 */
export function isClientMoneyRequestId(value: unknown): boolean {
  return parseUuid(value) !== undefined;
}

export function clientMoneyRequest(
  clientRequestId: string | undefined,
  operation: string,
  actorId: string,
  payload: unknown,
): EconomyCommandRequest | undefined {
  const requestId = parseUuid(clientRequestId);
  if (!requestId) return undefined;
  return { requestId, operation, actorId, payload };
}

/**
 * Trusted console or other server-owned work. Never used to fill in a
 * client packet that omitted its request id.
 */
export function serverMoneyRequest(
  operation: string,
  actorId: string,
  payload: unknown,
): EconomyCommandRequest {
  return {
    requestId: randomUUID(),
    operation,
    actorId,
    payload,
  };
}
