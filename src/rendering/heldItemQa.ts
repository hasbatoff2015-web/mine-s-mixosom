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

export const HELD_ITEM_POSE_CANDIDATE_IDS = ['subtle', 'balanced', 'stronger'] as const;
export type HeldItemPoseCandidateId = (typeof HELD_ITEM_POSE_CANDIDATE_IDS)[number];

/**
 * QA-only shared first-person candidates. Not production defaults.
 * Positive pitch shows top thickness; positive yaw shows left thickness.
 * Yaw stays far below vanilla −90° so pickaxe side spans do not become teeth.
 */
export const HELD_ITEM_POSE_CANDIDATES: Readonly<Record<HeldItemPoseCandidateId, HeldItemQaValues>> = Object.freeze({
  subtle: Object.freeze({
    scale: 0.85, x: 0.50, y: -0.56, z: -0.82, roll: 14, pitch: 4, yaw: 8,
  }),
  balanced: Object.freeze({
    scale: 0.88, x: 0.51, y: -0.54, z: -0.80, roll: 16, pitch: 8, yaw: 18,
  }),
  stronger: Object.freeze({
    scale: 0.92, x: 0.52, y: -0.52, z: -0.76, roll: 18, pitch: 12, yaw: 32,
  }),
});

/** Cycle list for `qaPoseCompare=1`. First four are the required representatives. */
export const HELD_ITEM_POSE_COMPARE_ITEMS = Object.freeze([
  'iron_pickaxe',
  'diamond_sword',
  'coal',
  'arrow',
  'stick',
  'apple',
  'bow',
  'torch',
] as const);

export function parseHeldItemPoseCandidate(
  search: string | URLSearchParams,
): HeldItemPoseCandidateId | undefined {
  const value = asSearchParams(search).get('qaPose');
  return (HELD_ITEM_POSE_CANDIDATE_IDS as readonly string[]).includes(value ?? '')
    ? value as HeldItemPoseCandidateId
    : undefined;
}

export function parseItemQaPoseCompare(search: string | URLSearchParams): boolean {
  const value = asSearchParams(search).get('qaPoseCompare');
  return value === '1' || value === 'true';
}

export function formatHeldItemCandidateUrl(
  itemId: string,
  candidate: HeldItemPoseCandidateId,
): string {
  return `?qaItem=${itemId}&qaView=held&pose=idle&qaPose=${candidate}&${formatHeldItemQaQuery(HELD_ITEM_POSE_CANDIDATES[candidate])}`;
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

/** Merge `qaPose=` candidate with explicit `held*` keys. Explicit keys win. */
export function resolveHeldItemQaFromSearch(search: string | URLSearchParams): HeldItemQaOverride | undefined {
  const candidateId = parseHeldItemPoseCandidate(search);
  const explicit = parseHeldItemQaOverride(search);
  if (!candidateId && !explicit) return undefined;
  return {
    ...(candidateId ? HELD_ITEM_POSE_CANDIDATES[candidateId] : undefined),
    ...explicit,
  };
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
  return resolveHeldItemQaFromSearch(location.search);
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

export const HELD_ITEM_QA_FIELD_ORDER = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'scale'] as const;
export type HeldItemQaField = (typeof HELD_ITEM_QA_FIELD_ORDER)[number];

export interface HeldItemQaFieldSpec {
  readonly field: HeldItemQaField;
  readonly label: string;
  readonly query: keyof typeof PARAMS;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const HELD_ITEM_QA_FIELDS: Readonly<Record<HeldItemQaField, HeldItemQaFieldSpec>> = Object.freeze({
  x: { field: 'x', label: 'X', query: 'heldX', min: -2, max: 2, step: 0.01 },
  y: { field: 'y', label: 'Y', query: 'heldY', min: -2, max: 2, step: 0.01 },
  z: { field: 'z', label: 'Z', query: 'heldZ', min: -3, max: 0, step: 0.01 },
  pitch: { field: 'pitch', label: 'Pitch', query: 'heldPitch', min: -90, max: 90, step: 1 },
  yaw: { field: 'yaw', label: 'Yaw', query: 'heldYaw', min: -90, max: 90, step: 1 },
  roll: { field: 'roll', label: 'Roll', query: 'heldRoll', min: -180, max: 180, step: 1 },
  scale: { field: 'scale', label: 'Scale', query: 'heldScale', min: 0.1, max: 3, step: 0.01 },
});

export const HELD_ITEM_QA_STORAGE_KEY = 'held-item-qa-pose';

export function cloneHeldItemQaValues(values: HeldItemQaValues): HeldItemQaValues {
  return {
    x: values.x,
    y: values.y,
    z: values.z,
    pitch: values.pitch,
    yaw: values.yaw,
    roll: values.roll,
    scale: values.scale,
  };
}

export function formatHeldItemQaScalar(value: number, digits = 4): string {
  return Number(value.toFixed(digits)).toString();
}

export function clampHeldItemQaField(field: HeldItemQaField, value: number): number {
  const spec = HELD_ITEM_QA_FIELDS[field];
  if (!Number.isFinite(value)) return spec.min;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const decimals = spec.step < 1 ? 4 : 2;
  return Number(clamped.toFixed(decimals));
}

export function clampHeldItemQaValues(values: HeldItemQaValues): HeldItemQaValues {
  return {
    x: clampHeldItemQaField('x', values.x),
    y: clampHeldItemQaField('y', values.y),
    z: clampHeldItemQaField('z', values.z),
    pitch: clampHeldItemQaField('pitch', values.pitch),
    yaw: clampHeldItemQaField('yaw', values.yaw),
    roll: clampHeldItemQaField('roll', values.roll),
    scale: clampHeldItemQaField('scale', values.scale),
  };
}

export function keyboardNudgeMultiplier(shift: boolean, alt: boolean): number {
  if (alt) return 0.1;
  if (shift) return 10;
  return 1;
}

/** DOM-free live pose. Item switching is out of band and must not call reset. */
export class HeldItemQaLiveState {
  private values: HeldItemQaValues;

  constructor(initial: HeldItemQaValues) {
    this.values = clampHeldItemQaValues(cloneHeldItemQaValues(initial));
  }

  get(): HeldItemQaValues {
    return cloneHeldItemQaValues(this.values);
  }

  set(next: HeldItemQaValues): HeldItemQaValues {
    this.values = clampHeldItemQaValues(cloneHeldItemQaValues(next));
    return this.get();
  }

  setField(field: HeldItemQaField, value: number): HeldItemQaValues {
    this.values = clampHeldItemQaValues({ ...this.values, [field]: value });
    return this.get();
  }

  nudge(field: HeldItemQaField, direction: -1 | 1, multiplier = 1): HeldItemQaValues {
    const step = HELD_ITEM_QA_FIELDS[field].step * multiplier;
    return this.setField(field, this.values[field] + direction * step);
  }
}

export function matchingHeldItemPoseCandidate(
  values: HeldItemQaValues,
): HeldItemPoseCandidateId | undefined {
  for (const id of HELD_ITEM_POSE_CANDIDATE_IDS) {
    const candidate = HELD_ITEM_POSE_CANDIDATES[id];
    if (heldItemQaValuesClose(values, candidate)) return id;
  }
  return undefined;
}

export function heldItemQaValuesClose(
  left: HeldItemQaValues,
  right: HeldItemQaValues,
  epsilon = 1e-4,
): boolean {
  return HELD_ITEM_QA_FIELD_ORDER.every((field) => Math.abs(left[field] - right[field]) <= epsilon);
}

export function formatHeldItemPoseBlock(values: HeldItemQaValues): string {
  return [
    `heldScale=${formatHeldItemQaScalar(values.scale)}`,
    `heldX=${formatHeldItemQaScalar(values.x)}`,
    `heldY=${formatHeldItemQaScalar(values.y)}`,
    `heldZ=${formatHeldItemQaScalar(values.z)}`,
    `heldPitch=${formatHeldItemQaScalar(values.pitch)}`,
    `heldYaw=${formatHeldItemQaScalar(values.yaw)}`,
    `heldRoll=${formatHeldItemQaScalar(values.roll)}`,
  ].join('\n');
}

export function formatHeldItemCopyQuery(itemId: string, values: HeldItemQaValues): string {
  return [
    `?qaItem=${itemId}`,
    'qaView=held',
    'pose=idle',
    `heldScale=${formatHeldItemQaScalar(values.scale)}`,
    `heldX=${formatHeldItemQaScalar(values.x)}`,
    `heldY=${formatHeldItemQaScalar(values.y)}`,
    `heldZ=${formatHeldItemQaScalar(values.z)}`,
    `heldPitch=${formatHeldItemQaScalar(values.pitch)}`,
    `heldYaw=${formatHeldItemQaScalar(values.yaw)}`,
    `heldRoll=${formatHeldItemQaScalar(values.roll)}`,
  ].join('&');
}

export function formatHeldItemPoseTs(values: HeldItemQaValues): string {
  return [
    '{',
    `  position: [${formatHeldItemQaScalar(values.x)}, ${formatHeldItemQaScalar(values.y)}, ${formatHeldItemQaScalar(values.z)}],`,
    `  rotationDeg: [${formatHeldItemQaScalar(values.pitch)}, ${formatHeldItemQaScalar(values.yaw)}, ${formatHeldItemQaScalar(values.roll)}],`,
    `  scale: ${formatHeldItemQaScalar(values.scale)},`,
    '}',
  ].join('\n');
}

export function formatHeldItemQaStatus(itemId: string | undefined, values: HeldItemQaValues): string {
  return [
    `Item:`,
    itemId ?? '(none)',
    '',
    `Position:`,
    `X ${formatHeldItemQaScalar(values.x)}`,
    `Y ${formatHeldItemQaScalar(values.y)}`,
    `Z ${formatHeldItemQaScalar(values.z)}`,
    '',
    `Rotation:`,
    `Pitch ${formatHeldItemQaScalar(values.pitch)}`,
    `Yaw ${formatHeldItemQaScalar(values.yaw)}`,
    `Roll ${formatHeldItemQaScalar(values.roll)}`,
    '',
    `Scale:`,
    formatHeldItemQaScalar(values.scale),
  ].join('\n');
}

export interface HeldItemQaStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function serializeHeldItemQaStorage(values: HeldItemQaValues): string {
  return JSON.stringify(clampHeldItemQaValues(values));
}

export function parseHeldItemQaStorage(raw: string | null | undefined): HeldItemQaValues | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<HeldItemQaValues>;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const values: HeldItemQaValues = {
      x: Number(parsed.x),
      y: Number(parsed.y),
      z: Number(parsed.z),
      pitch: Number(parsed.pitch),
      yaw: Number(parsed.yaw),
      roll: Number(parsed.roll),
      scale: Number(parsed.scale),
    };
    if (HELD_ITEM_QA_FIELD_ORDER.some((field) => !Number.isFinite(values[field]))) return undefined;
    return clampHeldItemQaValues(values);
  } catch {
    return undefined;
  }
}

export function readHeldItemQaStorage(storage?: HeldItemQaStorageLike | null): HeldItemQaValues | undefined {
  if (!storage) return undefined;
  try {
    return parseHeldItemQaStorage(storage.getItem(HELD_ITEM_QA_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function writeHeldItemQaStorage(
  values: HeldItemQaValues,
  storage?: HeldItemQaStorageLike | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(HELD_ITEM_QA_STORAGE_KEY, serializeHeldItemQaStorage(values));
  } catch {
    /* private-mode / disabled storage */
  }
}

/** URL `qaPose`/`held*` win. Otherwise restore the QA-only session snapshot. */
export function resolveHeldItemQaLiveInitial(
  base: HeldItemQaValues,
  search: string | URLSearchParams,
  storage?: HeldItemQaStorageLike | null,
): HeldItemQaValues {
  const fromUrl = resolveHeldItemQaFromSearch(search);
  if (fromUrl) {
    return clampHeldItemQaValues({ ...base, ...fromUrl });
  }
  const stored = readHeldItemQaStorage(storage);
  return stored ?? clampHeldItemQaValues(base);
}
