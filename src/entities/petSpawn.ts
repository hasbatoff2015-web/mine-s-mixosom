import type { Biome } from '../world/Generator';
import type { MobKind } from './mobDefinitions';
import { CAT_VARIANT_WEIGHTS } from './petConstants';
import type { CatVariant } from './petTypes';

interface WeightedKind {
  readonly kind: MobKind;
  readonly weight: number;
}

/** Forest/plains keep the old animals dominant; wolf/cat compete for leftover slots. */
const PLAINS_WEIGHTS: readonly WeightedKind[] = [
  { kind: 'cow', weight: 12 },
  { kind: 'pig', weight: 12 },
  { kind: 'chicken', weight: 10 },
  { kind: 'sheep', weight: 10 },
  { kind: 'cat', weight: 2 },
];

const FOREST_WEIGHTS: readonly WeightedKind[] = [
  { kind: 'cow', weight: 12 },
  { kind: 'pig', weight: 12 },
  { kind: 'chicken', weight: 10 },
  { kind: 'sheep', weight: 10 },
  { kind: 'wolf', weight: 2 },
  { kind: 'cat', weight: 2 },
];

const SNOWY_WEIGHTS: readonly WeightedKind[] = [
  { kind: 'cow', weight: 10 },
  { kind: 'pig', weight: 10 },
  { kind: 'chicken', weight: 8 },
  { kind: 'sheep', weight: 8 },
  { kind: 'wolf', weight: 2 },
];

const DESERT_WEIGHTS: readonly WeightedKind[] = [
  { kind: 'cow', weight: 12 },
  { kind: 'pig', weight: 12 },
  { kind: 'chicken', weight: 10 },
  { kind: 'sheep', weight: 10 },
];

export function passiveSpawnWeights(biome: Biome): readonly WeightedKind[] {
  if (biome === 'forest') return FOREST_WEIGHTS;
  if (biome === 'snowy_plains') return SNOWY_WEIGHTS;
  if (biome === 'desert') return DESERT_WEIGHTS;
  return PLAINS_WEIGHTS;
}

export function pickPassiveSpawnKind(biome: Biome, random: () => number): MobKind {
  const weights = passiveSpawnWeights(biome);
  let total = 0;
  for (const entry of weights) total += entry.weight;
  let roll = random() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll < 0) return entry.kind;
  }
  return weights[0]?.kind ?? 'cow';
}

export function pickCatVariant(random: () => number): CatVariant {
  const index = Math.floor(random() * CAT_VARIANT_WEIGHTS.length);
  return CAT_VARIANT_WEIGHTS[index] ?? 'black';
}
