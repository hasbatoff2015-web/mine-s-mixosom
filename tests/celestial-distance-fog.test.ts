import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNK_SIZE, DAY_TICKS, DEFAULT_RENDER_DISTANCE_DESKTOP, DEFAULT_RENDER_DISTANCE_MOBILE } from '../src/core/constants';
import {
  applyDistanceFog,
  distanceFogRange,
  linearFogBlend,
  visibleGeometryDistance,
} from '../src/rendering/distanceFog';
import {
  CELESTIAL_DISTANCE,
  CELESTIAL_RENDER_ORDER,
  SUNLIGHT_DIRECTION_SCALE,
  celestialOffset,
  celestialPositions,
  createMoonMesh,
  createMoonTexture,
  createSunMesh,
  createSunTexture,
  directionalLightTravel,
  sunlightPosition,
} from '../src/rendering/SkyDome';
import { sunDirection } from '../src/rendering/skyPalette';

const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');

function opaqueColors(data: Uint8Array): Set<string> {
  const colors = new Set<string>();
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
  }
  return colors;
}

function alphaMask(data: Uint8Array): string {
  let mask = '';
  for (let index = 3; index < data.length; index += 4) mask += data[index] === 0 ? '0' : '1';
  return mask;
}

describe('pixel sun billboard', () => {
  it('paints a 16×16 nearest disc with a gold rim, yellow body, and cream core', () => {
    const texture = createSunTexture();
    const again = createSunTexture();
    const data = texture.image.data as Uint8Array;
    expect(texture.image.width).toBe(16);
    expect(texture.image.height).toBe(16);
    expect(data[3]).toBe(0);
    expect(data[(15 * 16 + 15) * 4 + 3]).toBe(0);
    expect(data[(8 * 16 + 8) * 4 + 3]).toBe(255);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    const colors = opaqueColors(data);
    expect(colors.size).toBeGreaterThanOrEqual(3);
    expect(colors.has('241,207,98')).toBe(true);
    expect(colors.has('255,237,160')).toBe(true);
    expect(colors.has('255,246,200')).toBe(true);
    expect(alphaMask(data)).toBe(alphaMask(again.image.data as Uint8Array));
    expect(data).not.toEqual(createMoonTexture().image.data);
  });

  it('is a 6.4 quad, not a sphere, and does not write depth', () => {
    const sun = createSunMesh();
    const geometry = sun.geometry as THREE.PlaneGeometry;
    expect(sun.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(sun.geometry).not.toBeInstanceOf(THREE.SphereGeometry);
    expect(geometry.parameters.width).toBeCloseTo(6.4, 5);
    expect(geometry.parameters.height).toBeCloseTo(6.4, 5);
    expect(sun.renderOrder).toBe(CELESTIAL_RENDER_ORDER);
    expect(sun.frustumCulled).toBe(false);
    const material = sun.material as THREE.MeshBasicMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBeCloseTo(0.5, 5);
    expect(material.map).toBeTruthy();
  });

  it('leaves the moon as the existing 5.6 pixel quad', () => {
    const moon = createMoonMesh();
    const geometry = moon.geometry as THREE.PlaneGeometry;
    const data = (moon.material as THREE.MeshBasicMaterial).map!.image.data as Uint8Array;
    expect(moon.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(moon.geometry).not.toBeInstanceOf(THREE.SphereGeometry);
    expect(geometry.parameters.width).toBeCloseTo(5.6, 5);
    expect(geometry.parameters.height).toBeCloseTo(5.6, 5);
    expect(moon.renderOrder).toBe(CELESTIAL_RENDER_ORDER);
    const moonMaterial = moon.material as THREE.MeshBasicMaterial;
    expect(moonMaterial.depthWrite).toBe(false);
    expect(moonMaterial.depthTest).toBe(true);
    expect(moonMaterial.transparent).toBe(false);
    expect(moonMaterial.alphaTest).toBeCloseTo(0.5, 5);
    const crater = (6 * 16 + 5) * 4;
    expect([data[crater], data[crater + 1], data[crater + 2], data[crater + 3]]).toEqual([168, 186, 204, 255]);
    const body = (8 * 16 + 8) * 4;
    expect([data[body], data[body + 1], data[body + 2], data[body + 3]]).toEqual([226, 232, 238, 255]);
  });
});

describe('camera-relative celestial positions', () => {
  it('keeps the same sun and moon offset when the camera translates', () => {
    const dir = sunDirection(6_000);
    const origin = celestialPositions({ x: 0, y: 70, z: 0 }, dir);
    const shifted = celestialPositions({ x: 100, y: 70, z: -80 }, dir);
    const nudged = celestialPositions({ x: 0.2, y: 70, z: 0.1 }, dir);
    for (const next of [shifted, nudged]) {
      expect(next.sun.x - (next === shifted ? 100 : 0.2)).toBeCloseTo(origin.sun.x, 6);
      expect(next.sun.y - 70).toBeCloseTo(origin.sun.y - 70, 6);
      expect(next.sun.z - (next === shifted ? -80 : 0.1)).toBeCloseTo(origin.sun.z, 6);
      expect(next.moon.x - (next === shifted ? 100 : 0.2)).toBeCloseTo(origin.moon.x, 6);
      expect(next.moon.y - 70).toBeCloseTo(origin.moon.y - 70, 6);
      expect(next.moon.z - (next === shifted ? -80 : 0.1)).toBeCloseTo(origin.moon.z, 6);
    }
    const offset = celestialOffset(dir);
    expect(Math.hypot(offset.x, offset.y, offset.z)).toBeCloseTo(CELESTIAL_DISTANCE, 5);
    expect(CELESTIAL_DISTANCE).toBeCloseTo(Math.hypot(70, 15), 8);
    expect(origin.moon.x).toBeCloseTo(origin.sun.x - 2 * offset.x, 6);
    expect(shifted.moon.x - shifted.sun.x).toBeCloseTo(-(shifted.sun.x - 100) * 2, 5);
    expect(origin.moon.x - 0).toBeCloseTo(-offset.x, 6);
    expect(origin.moon.y - 70).toBeCloseTo(-offset.y, 6);
    expect(origin.moon.z).toBeCloseTo(-offset.z, 6);
  });

  it('matches the old orbit angles at the camera', () => {
    const time = 9_000;
    const phase = (time / DAY_TICKS) * Math.PI * 2;
    const offset = celestialOffset(sunDirection(time));
    expect(offset.x).toBeCloseTo(Math.cos(phase) * 70, 5);
    expect(offset.y).toBeCloseTo(Math.sin(phase) * 70, 5);
    expect(offset.z).toBeCloseTo(15, 5);
  });
});

describe('sunlight direction ignores the camera', () => {
  it('changes with time and stays put when the player moves', () => {
    const noon = sunDirection(6_000);
    const later = sunDirection(9_000);
    const noonTravel = directionalLightTravel(sunlightPosition(noon));
    const laterTravel = directionalLightTravel(sunlightPosition(later));
    expect(Math.hypot(laterTravel.x - noonTravel.x, laterTravel.y - noonTravel.y, laterTravel.z - noonTravel.z)).toBeGreaterThan(0.2);
    expect(noonTravel.x).toBeCloseTo(-noon.x, 5);
    expect(noonTravel.y).toBeCloseTo(-noon.y, 5);
    expect(noonTravel.z).toBeCloseTo(-noon.z, 5);
    expect(SUNLIGHT_DIRECTION_SCALE).toBe(100);

    const phase = (6_000 / DAY_TICKS) * Math.PI * 2;
    const oldNear = directionalLightTravel({
      x: Math.cos(phase) * 70,
      y: 70 + Math.sin(phase) * 70,
      z: 15,
    });
    const oldFar = directionalLightTravel({
      x: 1000 + Math.cos(phase) * 70,
      y: 70 + Math.sin(phase) * 70,
      z: 1000 + 15,
    });
    expect(Math.hypot(oldFar.x - oldNear.x, oldFar.y - oldNear.y, oldFar.z - oldNear.z)).toBeGreaterThan(0.5);
    const parked = directionalLightTravel(sunlightPosition(noon));
    expect(parked).toEqual(noonTravel);
    expect(gameSource).toContain('sunlightPosition(dir)');
    expect(gameSource).toContain('this.sunlight.target.position.set(0, 0, 0)');
    expect(gameSource).not.toContain('this.sunlight.position.copy(this.sun.position)');
    expect(gameSource).toContain('this.ambient.intensity = 0.14 + daylight * 0.32');
    expect(gameSource).toContain('this.sunlight.intensity = 0.18 + daylight * 1.55');
    expect(gameSource).toContain('session.worldRenderer.setDaylight(daylight)');
  });
});

describe('distance haze', () => {
  const legacyNear = 38;
  const legacyFar = DEFAULT_RENDER_DISTANCE_DESKTOP * 16 + 28;

  it('caps the far corner at 12% for render distances 2, 4, and 8', () => {
    for (const renderDistance of [2, 4, 8]) {
      const range = distanceFogRange(renderDistance);
      expect(range.near).toBeGreaterThan(0);
      expect(range.far).toBeGreaterThan(range.near);
      expect(range.visibleEdge).toBeGreaterThan(range.near);
      expect(range.visibleEdge).toBeLessThan(range.far);
      expect(range.visibleEdge).toBeCloseTo((renderDistance + 1) * CHUNK_SIZE * Math.SQRT2, 6);
      expect(linearFogBlend(range.visibleEdge, range.near, range.far)).toBeCloseTo(0.12, 5);
      expect(linearFogBlend(range.visibleEdge, range.near, range.far)).toBeLessThanOrEqual(0.13);
    }
  });

  it('keeps desktop terrain textured where the old fog was already opaque', () => {
    expect(DEFAULT_RENDER_DISTANCE_DESKTOP).toBe(4);
    expect(DEFAULT_RENDER_DISTANCE_MOBILE).toBe(2);
    expect(legacyFar).toBe(92);
    expect(linearFogBlend(64, legacyNear, legacyFar)).toBeCloseTo(26 / 54, 5);
    expect(linearFogBlend(90, legacyNear, legacyFar)).toBeCloseTo(52 / 54, 5);
    const desktop = distanceFogRange(4);
    expect(linearFogBlend(64, desktop.near, desktop.far)).toBeLessThan(0.02);
    expect(linearFogBlend(90, desktop.near, desktop.far)).toBeLessThan(0.12);
    expect(linearFogBlend(desktop.visibleEdge, desktop.near, desktop.far)).toBeCloseTo(0.12, 5);
    const mobile = distanceFogRange(2);
    expect(mobile.visibleEdge).toBeCloseTo(3 * 16 * Math.SQRT2, 5);
    expect(linearFogBlend(mobile.visibleEdge, mobile.near, mobile.far)).toBeCloseTo(0.12, 5);
    const wide = distanceFogRange(8);
    expect(linearFogBlend(wide.visibleEdge, wide.near, wide.far)).toBeCloseTo(0.12, 5);
    const fog = { near: 38, far: 92 };
    applyDistanceFog(fog, 4);
    expect(fog.near).toBeCloseTo(desktop.near, 5);
    expect(fog.far).toBeCloseTo(desktop.far, 5);
    expect(fog.near).not.toBe(38);
    expect(gameSource).toContain('applyDistanceFog(this.scene.fog, this.settings.renderDistance)');
    expect(gameSource).toContain('applyDistanceFog(this.scene.fog, settings.renderDistance)');
    expect(gameSource).not.toContain('renderDistance * 16 + 28');
    expect(visibleGeometryDistance(4)).toBeCloseTo(desktop.visibleEdge, 6);
  });
});
