import * as THREE from 'three';
import { BlockId, type HorizontalFacing, type RailShape } from '../blocks';
import { CHUNK_SIZE, chunkKey } from '../core/constants';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { Chunk } from '../world/Chunk';
import { disposeWorldLighting } from '../world/LightEngine';
import { VoxelWorld } from '../world/World';

type RailQaRow = 'all' | 'flat' | 'slope';

const TORCH_FACINGS: readonly HorizontalFacing[] = ['north', 'south', 'east', 'west'];

const FLAT_SHAPES: readonly RailShape[] = [
  'north_south', 'east_west', 'north_east', 'north_west', 'south_east', 'south_west',
];
const SLOPE_SHAPES: readonly RailShape[] = [
  'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west',
];

export async function startRailQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  requestedRow: string | null,
): Promise<() => void> {
  const row: RailQaRow = requestedRow === 'flat' || requestedRow === 'slope' ? requestedRow : 'all';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x90b9cf);
  const world = createRailQaWorld();
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 100);
  const view = row === 'flat'
    ? { position: [15, 45, 20] as const, look: [15, 40, 7] as const }
    : row === 'slope'
      ? { position: [15, 45, 27] as const, look: [15, 40.3, 17] as const }
      : { position: [15, 52, 37] as const, look: [15, 40, 12] as const };
  camera.position.set(view.position[0], view.position[1], view.position[2]);
  camera.lookAt(view.look[0], view.look[1], view.look[2]);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:13px/1.4 monospace;z-index:5;white-space:pre">RAIL QA · production WorldRenderer · ${row}\nflat: NS · EW · NE · NW · SE · SW\nslope: north · south · east · west</div>`;

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
    world.processLighting(3, 15, 12);
    worldRenderer.rebuildDirty(4, 8, 15, 12, { requireNeighborLight: false });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    worldRenderer.dispose();
    disposeWorldLighting(world);
    atlas.dispose();
    renderer.dispose();
  };
}

export async function startLightBlockQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16202b);
  const world = createLightBlockQaWorld();
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(0.22);
  scene.add(worldRenderer.group);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 100);
  camera.position.set(15, 50, 31);
  camera.lookAt(15, 40.8, 12);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:13px/1.4 monospace;z-index:5;white-space:pre">LIGHT BLOCK QA · production WorldRenderer\nrow 1 torch: floor · north · south · east · west\nrow 2 redstone: floor · north · south · east · west\nback: standing lantern · hanging lantern</div>`;

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
    world.processLighting(4, 15, 12);
    worldRenderer.rebuildDirty(4, 8, 15, 12, { requireNeighborLight: false });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    worldRenderer.dispose();
    disposeWorldLighting(world);
    atlas.dispose();
    renderer.dispose();
  };
}

function createRailQaWorld(): VoxelWorld {
  const world = new VoxelWorld('rail-render-qa');
  for (let chunkZ = 0; chunkZ <= 1; chunkZ += 1) {
    for (let chunkX = 0; chunkX <= 1; chunkX += 1) {
      const chunk = new Chunk(chunkX, chunkZ);
      chunk.generated = true;
      chunk.blocks.fill(BlockId.Stone, 0, 40 * CHUNK_SIZE * CHUNK_SIZE);
      chunk.occupancyTop = 39;
      chunk.surfaceHeights.fill(39);
      world.chunks.set(chunkKey(chunkX, chunkZ), chunk);
    }
  }
  placeShapeRow(world, FLAT_SHAPES, 7, 3);
  placeShapeRow(world, SLOPE_SHAPES, 17, 5);
  world.setViewCenter(15, 12, 1);
  world.deferredLighting = true;
  return world;
}

function createLightBlockQaWorld(): VoxelWorld {
  const world = new VoxelWorld('light-block-render-qa');
  for (let chunkZ = 0; chunkZ <= 1; chunkZ += 1) {
    for (let chunkX = 0; chunkX <= 1; chunkX += 1) {
      const chunk = new Chunk(chunkX, chunkZ);
      chunk.generated = true;
      chunk.blocks.fill(BlockId.Stone, 0, 40 * CHUNK_SIZE * CHUNK_SIZE);
      chunk.occupancyTop = 39;
      chunk.surfaceHeights.fill(39);
      world.chunks.set(chunkKey(chunkX, chunkZ), chunk);
    }
  }
  placeTorchMatrix(world, BlockId.Torch, 8);
  placeTorchMatrix(world, BlockId.RedstoneTorch, 16);
  world.setBlock(12, 40, 3, BlockId.Lantern, false);
  world.setBlockState(12, 40, 3, { attachment: 'floor' });
  world.setBlock(18, 44, 3, BlockId.Stone, false);
  world.setBlock(18, 43, 3, BlockId.Lantern, false);
  world.setBlockState(18, 43, 3, { attachment: 'ceiling' });
  world.setViewCenter(15, 12, 1);
  world.deferredLighting = true;
  return world;
}

function placeTorchMatrix(world: VoxelWorld, blockId: BlockId, z: number): void {
  world.setBlock(5, 40, z, blockId, false);
  world.setBlockState(5, 40, z, { attachment: 'floor', facing: 'north' });
  TORCH_FACINGS.forEach((facing, index) => {
    const x = 10 + index * 5;
    world.setBlock(x, 41, z, blockId, false);
    world.setBlockState(x, 41, z, { attachment: 'wall', facing });
    const [supportX, supportZ] = wallSupportOffset(facing);
    world.setBlock(x + supportX, 41, z + supportZ, BlockId.Stone, false);
  });
}

function wallSupportOffset(facing: HorizontalFacing): readonly [number, number] {
  switch (facing) {
    case 'north': return [0, 1];
    case 'south': return [0, -1];
    case 'east': return [-1, 0];
    case 'west': return [1, 0];
  }
}

function placeShapeRow(world: VoxelWorld, shapes: readonly RailShape[], z: number, spacing: number): void {
  const totalWidth = (shapes.length - 1) * spacing;
  const startX = Math.round(15 - totalWidth / 2);
  shapes.forEach((shape, index) => {
    const x = startX + index * spacing;
    world.setBlock(x, 40, z, BlockId.Rail, false);
    world.setBlockState(x, 40, z, { railShape: shape });
  });
}
