export const SETTLEMENT_KINDS = [
  'AUCTION_PURCHASE',
  'AUCTION_CLAIM',
  'BUYER_SALE',
  'TRADE_SETTLEMENT',
  'CLAN_CREATE',
] as const;
export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];

export const SETTLEMENT_PHASES = [
  'PREPARED',
  'ESCROW_DURABLE',
  'MONEY_COMMITTED',
  'DOMAIN_DURABLE',
  'DELIVERY_DURABLE',
  'COMPLETE',
  'CANCELLED',
  'RECOVERY_REQUIRED',
] as const;
export type SettlementPhase = (typeof SETTLEMENT_PHASES)[number];

export const TERMINAL_SETTLEMENT_PHASES = ['COMPLETE', 'CANCELLED', 'RECOVERY_REQUIRED'] as const;

const TRANSITIONS: Readonly<Record<SettlementPhase, readonly SettlementPhase[]>> = {
  PREPARED: ['ESCROW_DURABLE', 'MONEY_COMMITTED', 'DOMAIN_DURABLE', 'CANCELLED', 'RECOVERY_REQUIRED'],
  ESCROW_DURABLE: ['MONEY_COMMITTED', 'CANCELLED', 'RECOVERY_REQUIRED'],
  MONEY_COMMITTED: ['DOMAIN_DURABLE', 'DELIVERY_DURABLE', 'COMPLETE', 'RECOVERY_REQUIRED'],
  DOMAIN_DURABLE: ['DELIVERY_DURABLE', 'COMPLETE', 'RECOVERY_REQUIRED'],
  DELIVERY_DURABLE: ['COMPLETE', 'RECOVERY_REQUIRED'],
  COMPLETE: [],
  CANCELLED: [],
  RECOVERY_REQUIRED: [],
};

export function canTransition(from: SettlementPhase, to: SettlementPhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface SettlementRow {
  readonly settlementId: string;
  readonly deploymentId: string;
  readonly economyScope: string;
  readonly worldId: string;
  readonly kind: SettlementKind;
  readonly phase: SettlementPhase;
  readonly requestId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly lastErrorCode: string | null;
}

export interface BeginSettlementInput {
  readonly settlementId: string;
  readonly kind: SettlementKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
}

export class SettlementConflictError extends Error {
  readonly code = 'SETTLEMENT_CONFLICT' as const;
  constructor(message = 'settlement conflict') {
    super(message);
    this.name = 'SettlementConflictError';
  }
}

export class SettlementTransitionError extends Error {
  readonly code = 'SETTLEMENT_TRANSITION' as const;
  constructor(message = 'settlement transition rejected') {
    super(message);
    this.name = 'SettlementTransitionError';
  }
}
