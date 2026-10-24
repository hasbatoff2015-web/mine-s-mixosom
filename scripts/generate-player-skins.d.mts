export function generatePlayerSkinCatalog(options?: {
  readonly check?: boolean;
}): {
  readonly changed: boolean;
  readonly warnings: readonly string[];
  readonly outFile: string;
};

export function readSkinRarityAssignments(source: string): Record<string, string[]>;

export function assertPlayerSkinsHaveRarity(
  playerIds: readonly string[],
  groups: Record<string, readonly string[]>,
): void;
