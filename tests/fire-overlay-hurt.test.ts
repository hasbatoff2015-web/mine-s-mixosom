import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FP_FIRE_OVERLAY_OPACITY,
  FIRE_SECONDS_PER_FRAME,
  SharedFireTexture,
  firstPersonFireOverlayLayout,
  updateSharedFireAnimation,
} from '../src/rendering/fireTexture';
import { FIRE_PLANE_COUNT } from '../src/rendering/fireGeometry';
import {
  HURT_FLASH_PEAK_ALPHA,
  HURT_KICK_MAX_DEGREES,
  HurtFeedback,
} from '../src/rendering/hurtFeedback';
import { applyImmediateRenderLook } from '../src/rendering/cameraLook';
import { SurvivalSystem } from '../src/survival';

describe('first-person fire overlay', () => {
  it('uses two lower-viewport quads instead of a full-height 3D fire block', () => {
    const layout = firstPersonFireOverlayLayout();
    expect(layout.quads).toHaveLength(2);
    expect(layout.maxY).toBeLessThan(0);
    expect(layout.minY).toBeLessThan(layout.maxY);
    expect(layout.maxY).toBeLessThanOrEqual(-0.10);
    const overlay = SharedFireTexture.instance().createFirstPersonOverlay();
    expect(overlay.children).toHaveLength(2);
    overlay.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      expect(object.geometry).toBeInstanceOf(THREE.PlaneGeometry);
      const positions = object.geometry.getAttribute('position').count;
      expect(positions).toBe(4);
      expect(positions).toBeLessThan(FIRE_PLANE_COUNT * 4);
    });
    overlay.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  });

  it('shows only while burning and stays translucent', () => {
    expect(FP_FIRE_OVERLAY_OPACITY).toBeGreaterThanOrEqual(0.7);
    expect(FP_FIRE_OVERLAY_OPACITY).toBeLessThanOrEqual(0.85);
    const overlay = SharedFireTexture.instance().createFirstPersonOverlay();
    overlay.visible = false;
    expect(overlay.visible).toBe(false);
    overlay.visible = true;
    expect(overlay.visible).toBe(true);
    overlay.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  });

  it('animates by UV offset without rebuilding geometry', () => {
    const overlay = SharedFireTexture.instance().createFirstPersonOverlay();
    const mesh = overlay.children[0] as THREE.Mesh;
    const geometry = mesh.geometry;
    const before = SharedFireTexture.instance().texture.offset.y;
    updateSharedFireAnimation(FIRE_SECONDS_PER_FRAME + 0.01);
    expect(SharedFireTexture.instance().texture.offset.y).not.toBe(before);
    expect(mesh.geometry).toBe(geometry);
    overlay.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  });
});

describe('hurt feedback', () => {
  it('starts a red flash and camera kick only after real damage', () => {
    const hurt = new HurtFeedback();
    const survival = new SurvivalSystem({
      health: 20,
      onDamage: (result) => {
        if (!result.ignored && result.dealt > 0) hurt.trigger(0, { periodic: false });
      },
    });
    expect(hurt.flashAlpha(0)).toBe(0);
    expect(survival.damage(0, 'generic').ignored).toBe(true);
    expect(hurt.flashAlpha(0)).toBe(0);
    expect(survival.damage(4, 'melee').dealt).toBeGreaterThan(0);
    expect(hurt.flashAlpha(0)).toBeCloseTo(HURT_FLASH_PEAK_ALPHA, 5);
    expect(Math.abs(hurt.cameraRoll(40) * 180 / Math.PI)).toBeGreaterThan(0.2);
    expect(Math.abs(hurt.cameraRoll(40) * 180 / Math.PI)).toBeLessThanOrEqual(HURT_KICK_MAX_DEGREES);
  });

  it('decays with time and returns the camera roll to zero', () => {
    const hurt = new HurtFeedback();
    hurt.trigger(1000);
    expect(hurt.flashAlpha(1000)).toBeGreaterThan(0.2);
    expect(hurt.flashAlpha(1110)).toBeGreaterThan(0);
    expect(hurt.flashAlpha(1110)).toBeLessThan(hurt.flashAlpha(1000));
    expect(hurt.flashAlpha(1220)).toBe(0);
    expect(hurt.cameraRoll(1000)).toBe(0);
    expect(hurt.cameraRoll(1090)).not.toBe(0);
    expect(hurt.cameraRoll(1180)).toBe(0);
    const later = new HurtFeedback();
    later.trigger(5000);
    expect(later.flashAlpha(5110)).toBeCloseTo(hurt.flashAlpha(1110), 5);
  });

  it('keeps authoritative look and bounds repeated hits', () => {
    const hurt = new HurtFeedback();
    const look = { yaw: 0.4, pitch: -0.2 };
    const camera = new THREE.PerspectiveCamera();
    hurt.trigger(0);
    hurt.trigger(10);
    hurt.trigger(20);
    applyImmediateRenderLook(camera, look, hurt.cameraRoll(80));
    expect(camera.rotation.y).toBeCloseTo(0.4);
    expect(camera.rotation.x).toBeCloseTo(-0.2);
    expect(look).toEqual({ yaw: 0.4, pitch: -0.2 });
    expect(Math.abs(camera.rotation.z) * 180 / Math.PI).toBeLessThanOrEqual(HURT_KICK_MAX_DEGREES);
  });
});
