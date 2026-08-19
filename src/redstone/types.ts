import type * as THREE from 'three';
import type { BlockAttachment, HorizontalFacing } from '../blocks';

export type RedstoneSourceKind = 'torch' | 'lever' | 'button' | 'pressure_plate';

export interface RedstoneSourceSnapshot {
  readonly kind: RedstoneSourceKind;
  readonly position: readonly [number, number, number];
  readonly active: boolean;
  /** Present only for an active timed button. */
  readonly remainingSeconds?: number;
  /** Version 2: lever attachment survives save/reload. */
  readonly attachment?: BlockAttachment;
  /** Version 2: outward support-face direction for a lever. */
  readonly facing?: HorizontalFacing;
}

export interface SerializedPrimedTnt {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly fuseSeconds: number;
  readonly velocity?: readonly [number, number, number];
}

export interface SerializedRedstoneState {
  readonly version: 1 | 2;
  readonly sources: readonly RedstoneSourceSnapshot[];
  readonly primedTnt: readonly SerializedPrimedTnt[];
}

export interface RedstoneExplosionEvent {
  readonly id: string;
  readonly source: 'tnt';
  readonly position: THREE.Vector3;
  readonly power: number;
  readonly radius: number;
}

export interface RedstoneUpdateStats {
  readonly propagationSteps: number;
  readonly pendingPropagation: number;
  readonly activeSources: number;
  readonly primedTnt: number;
}
