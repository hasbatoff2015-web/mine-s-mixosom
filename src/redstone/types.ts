import type * as THREE from 'three';

export type RedstoneSourceKind = 'torch' | 'lever' | 'button' | 'pressure_plate';

export interface RedstoneSourceSnapshot {
  readonly kind: RedstoneSourceKind;
  readonly position: readonly [number, number, number];
  readonly active: boolean;
  /** Present only for an active timed button. */
  readonly remainingSeconds?: number;
}

export interface SerializedPrimedTnt {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly fuseSeconds: number;
}

export interface SerializedRedstoneState {
  readonly version: 1;
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
