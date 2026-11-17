/** Shared dimension id. Absent on old saves means the overworld. */
export type DimensionId = 'overworld' | 'nether';

export const DIMENSION_IDS: readonly DimensionId[] = ['overworld', 'nether'];

/** Fixed evening clock for the Nether. Gameplay daylight does not drive its sky. */
export const NETHER_TIME_OF_DAY = 12_800;

/** Visual terrain brightness while the Nether sky stays a static red gradient. */
export const NETHER_DAYLIGHT = 0.42;

export const NETHER_PORTAL_CHANNEL_MS = 3_000;

export const NETHER_UNSAFE_MESSAGE =
  'Не удалось телепортироваться в ад — в зоне телепорта нет безопасного места. Попробуйте построить портал на других координатах';

export const NETHER_BED_MESSAGE = 'В Аду нельзя использовать кровать.';

export function parseDimension(value: unknown): DimensionId {
  return value === 'nether' ? 'nether' : 'overworld';
}

/** Claim, home and teleport records keep the server id for the overworld. */
export function dimensionWorldId(serverWorldId: string, dimension: DimensionId): string {
  return dimension === 'nether' ? `${serverWorldId}:nether` : serverWorldId;
}

export function dimensionFromStoredWorldId(storedWorldId: string): DimensionId {
  return storedWorldId.endsWith(':nether') ? 'nether' : 'overworld';
}

export function sameServerWorld(storedWorldId: string, serverWorldId: string): boolean {
  return storedWorldId === serverWorldId || storedWorldId === `${serverWorldId}:nether`;
}
