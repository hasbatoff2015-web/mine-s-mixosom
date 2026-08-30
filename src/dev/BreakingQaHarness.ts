import * as THREE from 'three';
import { BlockId } from '../blocks';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { VoxelWorld } from '../world/World';
import { disposeWorldLighting } from '../world/LightEngine';
import type { VoxelHit } from '../world/World';

interface Sample {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}

function hitFor(sample: Sample): VoxelHit {
  return {
    x: sample.x,
    y: sample.y,
    z: sample.z,
    block: sample.block,
    distance: 1,
    normal: new THREE.Vector3(0, 1, 0),
    point: new THREE.Vector3(sample.x + 0.5, sample.y + 0.5, sample.z + 0.5),
  };
}

export async function startBreakingQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7eb6d9);
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const world = new VoxelWorld('breaking-overlay-qa');
  world.ensureChunks(8, 8, 2, 20);
  const floor = 40;
  for (let x = 2; x <= 14; x += 1) {
    for (let z = 4; z <= 12; z += 1) {
      world.setBlock(x, floor, z, BlockId.Stone);
      world.setBlock(x, floor + 1, z, BlockId.Air);
      world.setBlock(x, floor + 2, z, BlockId.Air);
    }
  }
  const samples: Sample[] = [
    { name: 'cube', x: 4, y: floor + 1, z: 8, block: BlockId.Stone },
    { name: 'slab', x: 6, y: floor + 1, z: 8, block: BlockId.OakSlab },
    { name: 'stairs', x: 8, y: floor + 1, z: 8, block: BlockId.OakStairs },
    { name: 'fence', x: 10, y: floor + 1, z: 8, block: BlockId.OakFence },
    { name: 'door', x: 12, y: floor + 1, z: 8, block: BlockId.OakDoor },
  ];
  world.setBlock(4, floor + 1, 8, BlockId.Stone);
  world.setBlock(6, floor + 1, 8, BlockId.OakSlab);
  world.setBlockState(6, floor + 1, 8, { slabType: 'bottom' });
  world.setBlock(8, floor + 1, 8, BlockId.OakStairs);
  world.setBlockState(8, floor + 1, 8, { facing: 'south', stairHalf: 'bottom' });
  world.setBlock(10, floor + 1, 8, BlockId.OakFence);
  world.setBlock(10, floor + 1, 9, BlockId.OakFence);
  world.setBlock(12, floor + 1, 8, BlockId.OakDoor);
  world.setBlock(12, floor + 2, 8, BlockId.OakDoor);
  world.setBlockState(12, floor + 1, 8, { facing: 'south', hinge: 'left', open: false, half: 'lower' });
  world.setBlockState(12, floor + 2, 8, { facing: 'south', hinge: 'left', open: false, half: 'upper' });
  world.setViewCenter(8, 8, 2);
  world.deferredLighting = true;
  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:14px monospace;z-index:5"></div>`;
  const label = uiRoot.querySelector<HTMLDivElement>('#qa-label')!;
  let sampleIndex = 0;
  let stage = 0;
  let cycle = true;
  let elapsed = 0;
  const applyOverlay = (): void => {
    const sample = samples[sampleIndex]!;
    worldRenderer.setTarget(hitFor(sample));
    worldRenderer.setBreakingProgress(hitFor(sample), (stage + 0.05) / 10);
    label.textContent = [
      'Breaking overlay QA (DEV)',
      `${sample.name}  stage ${stage}/9`,
      cycle ? 'auto-cycle ON (C to stop)' : 'auto-cycle OFF (C to start)',
      '0-9 stage  [ ] sample',
    ].join('\n');
  };
  const key = (event: KeyboardEvent): void => {
    if (event.code === 'KeyC') {
      cycle = !cycle;
      applyOverlay();
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'Minus') {
      sampleIndex = (sampleIndex + samples.length - 1) % samples.length;
      applyOverlay();
      return;
    }
    if (event.code === 'BracketRight' || event.code === 'Equal') {
      sampleIndex = (sampleIndex + 1) % samples.length;
      applyOverlay();
      return;
    }
    const digit = event.key >= '0' && event.key <= '9' ? Number(event.key) : -1;
    if (digit >= 0) {
      stage = digit;
      cycle = false;
      applyOverlay();
    }
  };
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
  applyOverlay();
  let frame = 0;
  const render = (): void => {
    world.processLighting(2, 8, 8);
    worldRenderer.rebuildDirty(2, 4, 8, 8, { requireNeighborLight: true });
    if (cycle) {
      elapsed += 1 / 60;
      if (elapsed >= 0.35) {
        elapsed = 0;
        stage = (stage + 1) % 10;
        applyOverlay();
      }
    }
    camera.position.set(8.5, floor + 4.2, 16.5);
    camera.lookAt(8.5, floor + 1.4, 8);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    removeEventListener('keydown', key);
    worldRenderer.dispose();
    disposeWorldLighting(world);
    atlas.dispose();
    renderer.dispose();
  };
}
