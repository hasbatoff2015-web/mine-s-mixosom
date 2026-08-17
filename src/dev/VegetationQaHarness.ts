import * as THREE from 'three';
import type { Biome } from '../world/Generator';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { VoxelWorld } from '../world/World';

export async function startVegetationQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  biome: Biome,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x83b9d8);
  scene.add(new THREE.HemisphereLight(0xe9f4ff, 0x4b442f, 1.5));
  const sun = new THREE.DirectionalLight(0xffefce, 1.9);
  sun.position.set(-8, 14, -6);
  scene.add(sun);
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const world = new VoxelWorld(`vegetation-qa-${biome}`);
  const center = findBiomeCenter(world, biome);
  world.ensureChunks(center.x, center.z, 2, 25);
  const worldRenderer = new WorldRenderer(world, atlas);
  scene.add(worldRenderer.group);
  worldRenderer.rebuildDirty(100, 1_000);
  const surface = world.surfaceY(center.x, center.z);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 140);
  camera.position.set(center.x + 10, surface + 7.5, center.z + 12);
  camera.lookAt(center.x, surface + 1.3, center.z);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">vegetation QA · ${biome}</div>`;
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
  const render = (): void => {
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    worldRenderer.dispose();
    atlas.dispose();
    renderer.dispose();
  };
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
