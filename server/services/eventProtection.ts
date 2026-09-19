import { MAX_WORLD_Y, MIN_WORLD_Y } from '../../src/core/constants';
import { CLAIM_PRIORITY_MAX, type Claim } from './claims';
import { volumesOverlap } from './claimAnchors';
import { volumeContains, type SelectionVolume } from './selection';

export const WORLD_EVENT_CLAIM_OWNER = '__world_events__';
export const WORLD_EVENT_CLAIM_NAME = 'Event location';

export const EVENT_CLAIM_CREATE_MESSAGE =
  'Нельзя создать приват: выбранная зона пересекается с активной ивентовой локацией.';
export const EVENT_CLAIM_ANCHOR_MESSAGE =
  'Нельзя установить блок-приват: его зона пересекается с активной ивентовой локацией.';
export const EVENT_BUILD_PROTECTION_MESSAGE = 'Эта территория временно защищена ивентом.';

export function eventProtectionVolume(structure: SelectionVolume): SelectionVolume {
  return {
    minX: structure.minX,
    maxX: structure.maxX,
    minZ: structure.minZ,
    maxZ: structure.maxZ,
    minY: MIN_WORLD_Y,
    maxY: MAX_WORLD_Y,
  };
}

export function buildEventSystemClaim(options: {
  readonly eventId: string;
  readonly worldId: string;
  readonly protection: SelectionVolume;
}): Claim {
  return {
    id: `world-event:${options.eventId}`,
    name: WORLD_EVENT_CLAIM_NAME,
    owner: WORLD_EVENT_CLAIM_OWNER,
    worldId: options.worldId,
    volume: options.protection,
    members: [],
    priority: CLAIM_PRIORITY_MAX,
    flags: {
      'block-break': false,
      'block-place': false,
      explosions: false,
    },
  };
}

export function volumeOverlapsEventProtection(
  volume: SelectionVolume,
  protection: SelectionVolume | undefined,
): boolean {
  if (!protection) return false;
  return volumesOverlap(volume, protection);
}

export function pointInEventProtection(
  protection: SelectionVolume | undefined,
  x: number,
  y: number,
  z: number,
): boolean {
  if (!protection) return false;
  return volumeContains(protection, x, y, z);
}
