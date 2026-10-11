import type { Database } from '../db/types';
import { IdempotencyService } from '../db/idempotency';
import type { ServerConfig } from '../config';
import type { EconomyService } from '../services/economy';
import type { JsonFileStore } from '../services/jsonStore';
import { KillStatistics } from '../services/killStats';
import type { CurrencyPort } from './currencyPort';
import { PostgresGameplayEconomy } from './postgresAuthority';
import { MegacoinService } from './service';

/**
 * `legacy_json` returns the existing service unchanged.
 * `postgres` does not write that service's balance file.
 */
export function createGameplayEconomy(
  config: ServerConfig,
  database: Database,
  store: JsonFileStore,
  placed: EconomyService,
): CurrencyPort {
  if (config.economy.backend !== 'postgres') return placed;
  if (!config.database.enabled || !database.enabled) {
    throw new Error('FC_ECONOMY_BACKEND=postgres requires a configured database.');
  }
  return new PostgresGameplayEconomy(
    new MegacoinService(database, config.database.deploymentId, config.serverMode),
    new IdempotencyService(database, config.database.deploymentId),
    placed,
    new KillStatistics(store),
  );
}
