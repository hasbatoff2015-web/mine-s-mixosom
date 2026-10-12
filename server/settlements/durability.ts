import type { ItemStack } from '../../src/inventory/types';

/**
 * Player inventory effects that must land in the same players.json write as
 * their receipt. Callers do not treat an in-memory session as that receipt.
 */
export interface ItemDurability {
  hasReceipt(playerId: string, receipt: string): boolean;
  escrow(playerId: string, receipt: string): Promise<void>;
  deliver(playerId: string, receipt: string, stack: ItemStack): Promise<'delivered' | 'already' | 'full' | 'missing'>;
  restore(playerId: string, receipt: string, stack: ItemStack): Promise<void>;
  dropReceipt(playerId: string, receipt: string): Promise<void>;
}
