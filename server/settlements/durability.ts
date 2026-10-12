import type { ItemStack } from '../../src/inventory/types';

/**
 * Player inventory effects that must land in the same players.json write as
 * their receipt. Callers do not treat an in-memory session as that receipt.
 */
export type ItemEffectResult = 'delivered' | 'already' | 'restored' | 'full' | 'missing';

export interface ItemDurability {
  hasReceipt(playerId: string, receipt: string): boolean;
  escrow(playerId: string, receipt: string): Promise<void>;
  deliver(playerId: string, receipt: string, stack: ItemStack): Promise<ItemEffectResult>;
  /** Inserts every stack or leaves the inventory unchanged. */
  deliverAll(playerId: string, receipt: string, stacks: readonly ItemStack[]): Promise<ItemEffectResult>;
  restore(playerId: string, receipt: string, stack: ItemStack): Promise<ItemEffectResult>;
  /** Puts every stack back, or leaves the inventory and receipt unchanged. */
  restoreAll(playerId: string, receipt: string, stacks: readonly ItemStack[]): Promise<ItemEffectResult>;
  dropReceipt(playerId: string, receipt: string): Promise<void>;
}
