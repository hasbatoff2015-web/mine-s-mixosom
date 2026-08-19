import { getItemDefinition } from '../items';
import type { BlockDefinition, ToolTier, ToolType } from './types';

const TIER_RANK: Readonly<Record<ToolTier, number>> = Object.freeze({
  hand: 0,
  wood: 1,
  stone: 2,
  iron: 3,
  diamond: 4,
});

export interface MiningToolView {
  readonly kind?: string;
  readonly tool?: ToolType;
  readonly tier?: ToolTier;
  readonly miningSpeed?: number;
}

/**
 * Java 1.9 harvest check: preferred tool speeds mining, but only
 * `requiresCorrectTool` blocks (stone/ores/furnace) use the /100 penalty.
 * Logs, dirt and similar stay harvestable by hand.
 */
export function canHarvestBlock(definition: BlockDefinition, tool?: MiningToolView | null): boolean {
  if (definition.hardness < 0 || definition.breakable === false) return false;
  if (definition.drop?.requiresCorrectTool !== true) return true;
  if (!definition.tool) return true;
  if (tool?.kind !== 'tool' || tool.tool !== definition.tool) return false;
  return TIER_RANK[tool.tier ?? 'hand'] >= TIER_RANK[definition.tier ?? 'hand'];
}

export function miningSpeedMultiplier(definition: BlockDefinition, tool?: MiningToolView | null): number {
  if (tool?.kind === 'tool' && definition.tool && tool.tool === definition.tool) {
    return tool.miningSpeed ?? 1;
  }
  return 1;
}

/** Progress added once per 20 TPS mining tick. Creative callers should bypass this. */
export function miningProgressPerTick(definition: BlockDefinition, tool?: MiningToolView | null): number {
  if (definition.hardness < 0 || definition.breakable === false) return 0;
  if (definition.hardness <= 0) return 1;
  const speed = miningSpeedMultiplier(definition, tool);
  const divisor = canHarvestBlock(definition, tool) ? 30 : 100;
  return speed / definition.hardness / divisor;
}

export function miningToolFromItemId(itemId?: string | null): MiningToolView | undefined {
  if (!itemId) return undefined;
  try {
    return getItemDefinition(itemId);
  } catch {
    return undefined;
  }
}

export function breakTimeSeconds(definition: BlockDefinition, tool?: MiningToolView | null): number {
  const progress = miningProgressPerTick(definition, tool);
  if (progress <= 0) return Number.POSITIVE_INFINITY;
  if (progress >= 1) return 0;
  return Math.ceil(1 / progress) / 20;
}
