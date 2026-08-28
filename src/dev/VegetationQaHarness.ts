import * as THREE from 'three';
import { BlockId } from '../blocks';
import type { Biome } from '../world/Generator';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { VoxelWorld } from '../world/World';
import { lightFrameStats } from '../world/LightEngine';
import { setWorldLightDebug } from '../rendering/worldLighting';
import { createLightingQaScene, lightingQaOpening, lightingQaRoofHole, lightingQaSkyLine, type LightingQaScene } from './lightingQaScenes';

export type VegetationQaTime = 'day' | 'night';

export async function startVegetationQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  biome: Biome,
  time: VegetationQaTime = 'day',
  lightingScene?: LightingQaScene,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const night = time === 'night';
  scene.background = new THREE.Color(night ? 0x0b1020 : 0x83b9d8);
  const ambient = new THREE.HemisphereLight(
    night ? 0x8ea7d4 : 0xb7d7f2,
    0x1a1612,
    night ? 0.14 : 0.46,
  );
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(night ? 0x8ea7d4 : 0xffe2b3, night ? 0.18 : 1.73);
  sun.position.set(40, night ? 12 : 70, 25);
  scene.add(sun);
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const world = lightingScene ? createLightingQaScene(lightingScene) : new VoxelWorld(`vegetation-qa-${biome}`);
  const center = lightingScene ? { x: 14, z: 16 } : findBiomeCenter(world, biome);
  if (!lightingScene) world.ensureChunks(center.x, center.z, 2, 25);
  const surface = lightingScene ? 39 : world.surfaceY(center.x, center.z);
  if (night && !lightingScene) placeNightTorch(world, center.x, surface, center.z);
  world.setViewCenter(center.x, center.z, 1);
  world.deferredLighting = true;
  const worldRenderer = new WorldRenderer(world, atlas);
  worldRenderer.setDaylight(night ? 0.08 : 1);
  scene.add(worldRenderer.group);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 140);
  const look = new THREE.Vector3(center.x, surface + 1.3, center.z);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">vegetation QA · ${biome} · ${time}</div>`;
  let wallOpen = lightingScene === 'room' || lightingScene === 'cave' || lightingScene === 'sources';
  let holeOpen = lightingScene === 'hole';
  let isNight = night;
  let lightMode = 0;
  let peakSlice = 0;
  const label = uiRoot.querySelector<HTMLDivElement>('#qa-label')!;
  if (lightingScene) {
    label.style.pointerEvents = 'auto';
    label.style.fontSize = '12px';
    label.style.maxWidth = 'calc(100vw - 56px)';
    label.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <strong>Lighting QA: ${lightingScene}</strong>
      <button data-action="wall">Wall</button><button data-action="hole">Roof hole</button>
      <button data-action="day">Day / night</button><button data-action="mode">FINAL</button>
      <select aria-label="Light source"><option value="0">No source</option><option value="${BlockId.Torch}">Torch</option>
      <option value="${BlockId.Glowstone}">Glowstone</option><option value="${BlockId.Lantern}">Lantern</option></select>
      </div><pre data-lighting-stats style="white-space:pre-wrap;margin:6px 0 0"></pre>`;
    for (const control of label.querySelectorAll<HTMLElement>('button, select')) {
      control.style.cssText = 'color:#fff;background:#34383d;border:1px solid #8d949b;border-radius:2px;min-height:32px;padding:2px 8px';
    }
  }
  const cycleMode = (): void => {
    lightMode = (lightMode + 1) % 3;
    setWorldLightDebug(lightMode);
    const button = label.querySelector('[data-action="mode"]');
    if (button) button.textContent = ['FINAL', 'SKY', 'BLOCK'][lightMode]!;
  };
  const click = (event: Event): void => {
    const action = (event.target as HTMLElement).dataset.action;
    if (action === 'wall') world.applyBlockBatch(lightingQaOpening(wallOpen = !wallOpen));
    if (action === 'hole') world.applyBlockBatch(lightingQaRoofHole(holeOpen = !holeOpen));
    if (action === 'mode') cycleMode();
    if (action === 'day') {
      isNight = !isNight;
      worldRenderer.setDaylight(isNight ? 0.08 : 1);
      scene.background = new THREE.Color(isNight ? 0x0b1020 : 0x83b9d8);
    }
  };
  const change = (event: Event): void => {
    world.setBlock(11, 40, 16, Number((event.target as HTMLSelectElement).value) as BlockId);
  };
  const key = (event: KeyboardEvent): void => {
    if (event.code === 'F7') { event.preventDefault(); cycleMode(); }
  };
  label.addEventListener('click', click);
  label.addEventListener('change', change);
  addEventListener('keydown', key);
  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  let frame = 0;
  let angle = 0.55;
  let statsAt = 0;
  const render = (): void => {
    world.processLighting(2, center.x, center.z);
    peakSlice = Math.max(peakSlice, lightFrameStats.maxSlice);
    worldRenderer.rebuildDirty(2, 4, center.x, center.z, { requireNeighborLight: true });
    angle += 0.0035;
    if (lightingScene && lightingScene !== 'forest') {
      camera.position.set(3.4, 43.6, 16);
      camera.lookAt(18, 41.8, 16);
    } else {
      camera.position.set(
        look.x + Math.cos(angle) * 14,
        surface + (lightingScene === 'forest' ? 4 : 6.8),
        look.z + Math.sin(angle) * 14,
      );
      camera.lookAt(look);
    }
    if (lightingScene && performance.now() - statsAt > 250) {
      const stats = label.querySelector('[data-lighting-stats]');
      if (stats) stats.textContent = `SKY ${lightingQaSkyLine(world).join(' ')}\nLIGHT pending ${world.pendingLightJobs} | maxSlice ${peakSlice.toFixed(2)} ms | meshes ${worldRenderer.chunkCount}`;
      statsAt = performance.now();
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    removeEventListener('keydown', key);
    label.removeEventListener('click', click);
    label.removeEventListener('change', change);
    setWorldLightDebug(0);
    worldRenderer.dispose();
    atlas.dispose();
    renderer.dispose();
  };
}

function placeNightTorch(world: VoxelWorld, x: number, surface: number, z: number): void {
  const y = surface + 1;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      world.setBlock(x + dx, y, z + dz, BlockId.Air);
      world.setBlock(x + dx, y + 1, z + dz, BlockId.Air);
    }
  }
  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      world.setBlock(x + dx, y + 3, z + dz, BlockId.Stone);
    }
  }
  world.setBlock(x, surface, z, BlockId.GrassBlock);
  world.setBlock(x + 1, y, z, BlockId.TallGrass);
  world.setBlock(x - 1, y, z, BlockId.Fern);
  world.setBlock(x, y, z + 1, BlockId.Poppy);
  world.setBlock(x, y, z - 1, BlockId.Dandelion);
  world.setBlock(x, y, z, BlockId.Torch);
}

function findBiomeCenter(world: VoxelWorld, target: Biome): { x: number; z: number } {
  let best = { x: 8, z: 8, score: -1 };
  for (let chunkZ = -96; chunkZ <= 96; chunkZ += 1) {
    for (let chunkX = -96; chunkX <= 96; chunkX += 1) {
      const worldX = chunkX * 16 + 8;
      const worldZ = chunkZ * 16 + 8;
      const center = world.generator.columnAt(worldX, worldZ);
      if (center.biome !== target || center.height <= 50) continue;
      let score = 0;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (world.generator.columnAt(worldX + dx * 16, worldZ + dz * 16).biome === target) score += 1;
        }
      }
      if (score > best.score) best = { x: worldX, z: worldZ, score };
      if (score === 9) return best;
    }
  }
  return best;
}
