export function auctionListingReceipt(settlementId: string): string {
  return `auction-listing:${settlementId}:escrowed`;
}

export function auctionDeliveryReceipt(settlementId: string): string {
  return `auction:${settlementId}:delivered`;
}

export function auctionClaimReceipt(settlementId: string): string {
  return `auction-claim:${settlementId}:delivered`;
}

export function buyerConsumedReceipt(settlementId: string): string {
  return `buyer:${settlementId}:consumed`;
}

export function tradeEscrowReceipt(settlementId: string): string {
  return `trade:${settlementId}:escrowed`;
}

export function tradeDeliveryReceipt(settlementId: string, playerId: string): string {
  return `trade:${settlementId}:delivered:${playerId}`;
}

export function stackRecord(stack: { itemId: string; count: number; durability?: number; metadata?: unknown }): Record<string, unknown> {
  return {
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.durability !== undefined ? { durability: stack.durability } : {}),
    ...(stack.metadata !== undefined ? { metadata: stack.metadata } : {}),
  };
}
