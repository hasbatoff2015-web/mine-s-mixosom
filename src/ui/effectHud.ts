import { TICK_RATE } from '../core/constants';
import { ItemId, type StatusEffectId } from '../items/types';

export interface PotionHudEntry {
  readonly id: StatusEffectId;
  readonly name: string;
  readonly timer: string;
  readonly itemId: string;
}

const POTION_HUD_SPECS = [
  { id: 'invisibility', name: 'Невидимость', itemId: ItemId.PotionInvisibility },
  { id: 'regeneration', name: 'Регенерация', itemId: ItemId.PotionRegeneration },
] as const satisfies ReadonlyArray<{
  readonly id: StatusEffectId;
  readonly name: string;
  readonly itemId: string;
}>;

/** Real-time `M:SS` from remaining simulation ticks at 20 TPS. */
export function formatEffectCountdown(ticks: number): string {
  const seconds = Math.max(0, Math.ceil(Math.max(0, ticks) / TICK_RATE));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

export function potionHudEntries(effectTicks: (id: StatusEffectId) => number): PotionHudEntry[] {
  const entries: PotionHudEntry[] = [];
  for (const spec of POTION_HUD_SPECS) {
    const ticks = effectTicks(spec.id);
    if (ticks <= 0) continue;
    entries.push({
      id: spec.id,
      name: spec.name,
      timer: formatEffectCountdown(ticks),
      itemId: spec.itemId,
    });
  }
  return entries;
}
