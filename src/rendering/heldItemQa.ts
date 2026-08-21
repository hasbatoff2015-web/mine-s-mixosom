import type { ItemViewTransform, RenderVector } from '../items';

export interface HeldItemQaOverride {
  readonly scale?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly roll?: number;
  readonly pitch?: number;
  readonly yaw?: number;
}

export interface HeldItemQaValues {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly roll: number;
  readonly pitch: number;
  readonly yaw: number;
}

const PARAMS = {
  heldScale: 'scale',
  heldX: 'x',
  heldY: 'y',
  heldZ: 'z',
  heldRoll: 'roll',
  heldPitch: 'pitch',
  heldYaw: 'yaw',
} as const satisfies Record<string, keyof HeldItemQaOverride>;

function readNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse `heldScale/heldX/heldY/heldZ/heldRoll/heldPitch/heldYaw` from a query string.
 *  `heldScale` replaces the final Three.js uniform scale; it is not multiplied by 0.68. */
export function parseHeldItemQaOverride(search: string | URLSearchParams): HeldItemQaOverride | undefined {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  const override: Partial<Record<keyof HeldItemQaOverride, number>> = {};
  let present = false;
  for (const [query, field] of Object.entries(PARAMS)) {
    const value = readNumber(params.get(query));
    if (value === undefined) continue;
    override[field] = value;
    present = true;
  }
  return present ? override : undefined;
}

export function heldItemQaValuesFromTransform(transform: ItemViewTransform): HeldItemQaValues {
  const toDeg = (radians: number): number => radians * 180 / Math.PI;
  return {
    x: transform.position[0],
    y: transform.position[1],
    z: transform.position[2],
    pitch: toDeg(transform.rotation[0]),
    yaw: toDeg(transform.rotation[1]),
    roll: toDeg(transform.rotation[2]),
    scale: transform.scale[0],
  };
}

export function formatHeldItemQaQuery(values: HeldItemQaValues): string {
  const fmt = (value: number): string => Number(value.toFixed(4)).toString();
  return [
    `heldScale=${fmt(values.scale)}`,
    `heldX=${fmt(values.x)}`,
    `heldY=${fmt(values.y)}`,
    `heldZ=${fmt(values.z)}`,
    `heldRoll=${fmt(values.roll)}`,
    `heldPitch=${fmt(values.pitch)}`,
    `heldYaw=${fmt(values.yaw)}`,
  ].join('&');
}

export function resolveHeldItemTransform(
  base: ItemViewTransform,
  override?: HeldItemQaOverride,
): ItemViewTransform {
  if (!override) return base;
  const values = heldItemQaValuesFromTransform(base);
  const next: HeldItemQaValues = {
    scale: override.scale ?? values.scale,
    x: override.x ?? values.x,
    y: override.y ?? values.y,
    z: override.z ?? values.z,
    roll: override.roll ?? values.roll,
    pitch: override.pitch ?? values.pitch,
    yaw: override.yaw ?? values.yaw,
  };
  const radians = (degrees: number): number => degrees * Math.PI / 180;
  return {
    position: Object.freeze([next.x, next.y, next.z]) as RenderVector,
    rotation: Object.freeze([radians(next.pitch), radians(next.yaw), radians(next.roll)]) as RenderVector,
    scale: Object.freeze([next.scale, next.scale, next.scale]) as RenderVector,
  };
}

export function readDevHeldItemQaOverride(): HeldItemQaOverride | undefined {
  if (typeof location === 'undefined') return undefined;
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV === false) return undefined;
  return parseHeldItemQaOverride(location.search);
}

export const ITEM_QA_VIEWS = ['front', 'back', 'left', 'right', 'held'] as const;
export type ItemQaView = (typeof ITEM_QA_VIEWS)[number];

function asSearchParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
}

/** Isolated geometry inspect is the default. `qaView=held` restores first-person pose. */
export function parseItemQaView(search: string | URLSearchParams): ItemQaView {
  const value = asSearchParams(search).get('qaView');
  return (ITEM_QA_VIEWS as readonly string[]).includes(value ?? '') ? value as ItemQaView : 'front';
}

export function parseItemQaSideDebug(search: string | URLSearchParams): boolean {
  const value = asSearchParams(search).get('qaSideDebug');
  return value === '1' || value === 'true';
}
