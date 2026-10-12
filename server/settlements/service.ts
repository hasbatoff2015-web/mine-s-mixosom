import type { Database } from '../db/types';
import { PostgresSettlementRepository } from './repository';
import {
  SettlementConflictError,
  type BeginSettlementInput,
  type SettlementPhase,
  type SettlementRow,
} from './types';

/**
 * One gameplay settlement. The journal is mutable. The payload is not.
 * Money truth stays in the ledger. This table only remembers how far the
 * filesystem side effects got.
 */
export class SettlementService {
  constructor(
    private readonly database: Database,
    private readonly repository: PostgresSettlementRepository,
  ) {}

  static postgres(
    database: Database,
    deploymentId: string,
    economyScope: string,
    worldId: string,
  ): SettlementService {
    return new SettlementService(
      database,
      new PostgresSettlementRepository(deploymentId, economyScope, worldId),
    );
  }

  begin(input: BeginSettlementInput): Promise<SettlementRow> {
    return this.database.transaction((tx) => this.repository.begin(tx, input));
  }

  get(settlementId: string): Promise<SettlementRow | null> {
    return this.database.transaction((tx) => this.repository.get(tx, settlementId));
  }

  async transition(settlementId: string, from: SettlementPhase, to: SettlementPhase, errorCode?: string): Promise<SettlementRow> {
    return this.database.transaction((tx) => this.repository.transition(tx, settlementId, from, to, errorCode));
  }

  /** Move forward only when the row is still in `from`. A retry that already advanced is success. */
  async advance(settlementId: string, from: SettlementPhase, to: SettlementPhase): Promise<SettlementRow> {
    const current = await this.get(settlementId);
    if (!current) throw new SettlementConflictError('settlement missing');
    if (current.phase === to || phaseAtLeast(current.phase, to)) return current;
    if (current.phase !== from) throw new SettlementConflictError(`expected ${from}, saw ${current.phase}`);
    return this.transition(settlementId, from, to);
  }

  listOpen(): Promise<readonly SettlementRow[]> {
    return this.database.transaction((tx) => this.repository.listOpen(tx));
  }

  listPending(): Promise<readonly SettlementRow[]> {
    return this.listOpen();
  }
}

const ORDER: readonly SettlementPhase[] = [
  'PREPARED',
  'ESCROW_DURABLE',
  'MONEY_COMMITTED',
  'DOMAIN_DURABLE',
  'DELIVERY_DURABLE',
  'COMPLETE',
];

function phaseAtLeast(current: SettlementPhase, target: SettlementPhase): boolean {
  if (current === 'CANCELLED' || current === 'RECOVERY_REQUIRED') return false;
  const left = ORDER.indexOf(current);
  const right = ORDER.indexOf(target);
  return left >= 0 && right >= 0 && left >= right;
}
