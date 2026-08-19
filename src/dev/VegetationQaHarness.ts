import * as THREE from 'three';
import { BlockId } from '../blocks';
import type { Biome } from '../world/Generator';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { VoxelWorld } from '../world/World';

export type VegetationQaTime = 'day' | 'night';

export async function startVegetationQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  biome: Biome,
  time: VegetationQaTime = 'day',
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
  const world = new VoxelWorld(`vegetation-qa-${biome}`);
  const center = findBiomeCenter(world, biome);
  world.ensureChunks(center.x, center.z, 2, 25);
  const surface = world.surfaceY(center.x, center.z);
  if (night) placeNightTorch(world, center.x, surface, center.z);
  const worldRenderer = new WorldRenderer(world, atlas);
  scene.add(worldRenderer.group);
  worldRenderer.rebuildDirty(100, 1_000);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 140);
  const look = new THREE.Vector3(center.x, surface + 1.3, center.z);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">vegetation QA · ${biome} · ${time}</div>`;
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
  const render = (): void => {
    angle += 0.0035;
    camera.position.set(
      look.x + Math.cos(angle) * 14,
      surface + 6.8,
      look.z + Math.sin(angle) * 14,
    );
    camera.lookAt(look);
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
