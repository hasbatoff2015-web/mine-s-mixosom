export function generatePlayerSkinCatalog(options?: {
  readonly check?: boolean;
}): {
  readonly changed: boolean;
  readonly warnings: readonly string[];
  readonly outFile: string;
};
