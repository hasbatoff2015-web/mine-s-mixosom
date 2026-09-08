import { BlockId } from '../blocks';
import { isTntBlock } from '../blocks/tnt';

export type TntKind = 'ordinary' | 'powerful' | 'destructive';

export interface TntProfile {
  readonly kind: TntKind;
  readonly blockId: BlockId;
  readonly radius: number;
  readonly power: number;
  readonly canBreakObsidian: boolean;
  readonly canBreakBlockClaims: boolean;
  readonly canBreakRegularClaims: boolean;
}

/** Existing ordinary TNT blast size. Do not change. */
export const ORDINARY_TNT_RADIUS = 4;
export const ORDINARY_TNT_POWER = 4;
export const POWERFUL_TNT_RADIUS = 6;

export const ORDINARY_TNT_PROFILE: TntProfile = Object.freeze({
  kind: 'ordinary',
  blockId: BlockId.Tnt,
  radius: ORDINARY_TNT_RADIUS,
  power: ORDINARY_TNT_POWER,
  canBreakObsidian: false,
  canBreakBlockClaims: false,
  canBreakRegularClaims: false,
});

export const POWERFUL_TNT_PROFILE: TntProfile = Object.freeze({
  kind: 'powerful',
  blockId: BlockId.TntPowerful,
  radius: POWERFUL_TNT_RADIUS,
  power: ORDINARY_TNT_POWER,
  canBreakObsidian: false,
  canBreakBlockClaims: true,
  canBreakRegularClaims: false,
});

export const DESTRUCTIVE_TNT_PROFILE: TntProfile = Object.freeze({
  kind: 'destructive',
  blockId: BlockId.TntDestructive,
  radius: ORDINARY_TNT_RADIUS,
  power: ORDINARY_TNT_POWER,
  canBreakObsidian: true,
  canBreakBlockClaims: true,
  canBreakRegularClaims: false,
});

const PROFILES: Readonly<Record<TntKind, TntProfile>> = Object.freeze({
  ordinary: ORDINARY_TNT_PROFILE,
  powerful: POWERFUL_TNT_PROFILE,
  destructive: DESTRUCTIVE_TNT_PROFILE,
});

export function tntKindForBlock(blockId: number): TntKind {
  if (blockId === BlockId.TntPowerful) return 'powerful';
  if (blockId === BlockId.TntDestructive) return 'destructive';
  return 'ordinary';
}

export function getTntProfile(blockId: number = BlockId.Tnt): TntProfile {
  return PROFILES[tntKindForBlock(isTntBlock(blockId) ? blockId : BlockId.Tnt)];
}
