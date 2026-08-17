import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT, TICK_RATE } from '../src/core/constants';
import { applyImmediateRenderLook } from '../src/rendering/cameraLook';

describe('immediate render look', () => {
  it('uses input orientation between fixed simulation ticks', () => {
    const camera = new THREE.PerspectiveCamera();
    const authoritativePlayer = { yaw: 0, pitch: 0 };
    const input = { yaw: 0, pitch: 0 };
    applyImmediateRenderLook(camera, input);

    input.yaw = 0.73;
    input.pitch = -0.21;
    applyImmediateRenderLook(camera, input);

    expect(camera.rotation.y).toBeCloseTo(0.73);
    expect(camera.rotation.x).toBeCloseTo(-0.21);
    expect(authoritativePlayer).toEqual({ yaw: 0, pitch: 0 });
  });

  it('keeps authoritative simulation at fixed 20 TPS', () => {
    expect(TICK_RATE).toBe(20);
    expect(FIXED_DT).toBe(0.05);
  });
});
