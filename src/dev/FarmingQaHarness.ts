import * as THREE from 'three';
import { BlockId } from '../blocks';
import { ItemId } from '../items';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { disposeWorldLighting } from '../world/LightEngine';
import { VoxelWorld } from '../world/World';

export async function startFarmingQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc5df);
  scene.add(new THREE.HemisphereLight(0xc8e2f5, 0x2a2119, 0.65));
  const sun = new THREE.DirectionalLight(0xffe4b9, 1.6);
  sun.position.set(30, 50, 22);
  scene.add(sun);

  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const itemVisuals = new ItemVisualFactory({ atlas });
  await itemVisuals.preload();
  const world = new VoxelWorld('farming-qa');
  world.ensureChunks(8, 8, 1, 25);
  const surface = world.surfaceY(8, 8) + 1;
  const changes: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  for (let z = 3; z <= 13; z += 1) for (let x = 1; x <= 15; x += 1) {
    changes.push({ x, y: surface, z, block: (x === 9 || x === 10) ? BlockId.Water : BlockId.Farmland });
    changes.push({ x, y: surface + 1, z, block: BlockId.Air });
  }
  const cropRows = [BlockId.WheatCrop, BlockId.CarrotCrop, BlockId.PotatoCrop] as const;
  cropRows.forEach((block, row) => {
    for (let age = 0; age <= 7; age += 1) changes.push({ x: age + 1, y: surface + 1, z: 4 + row * 2, block });
  });
  changes.push(
    { x: 4, y: surface + 1, z: 11, block: BlockId.MelonStem },
    { x: 3, y: surface + 1, z: 11, block: BlockId.Melon },
    { x: 7, y: surface + 1, z: 11, block: BlockId.PumpkinStem },
    { x: 7, y: surface + 1, z: 12, block: BlockId.Pumpkin },
  );
  world.applyBlockBatch(changes, { deferLighting: false, scheduleNeighbors: false });
  for (let z = 3; z <= 13; z += 1) for (let x = 1; x <= 15; x += 1) {
    if (world.getBlock(x, surface, z, false) === BlockId.Farmland) {
      world.setBlockState(x, surface, z, { hydrated: x <= 7 });
    }
  }
  cropRows.forEach((_block, row) => {
    for (let age = 0; age <= 7; age += 1) world.setBlockState(age + 1, surface + 1, 4 + row * 2, { age });
  });
  world.setBlockState(4, surface + 1, 11, { age: 7 });
  world.setBlockState(7, surface + 1, 11, { age: 7 });
  world.setViewCenter(8, 8, 1);
  world.deferredLighting = true;

  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);
  const galleryItems = [
    ItemId.WoodenHoe, ItemId.StoneHoe, ItemId.IronHoe, ItemId.GoldenHoe, ItemId.DiamondHoe,
    ItemId.BoneMeal, ItemId.WheatSeeds, ItemId.Carrot, ItemId.Potato,
    ItemId.MelonSeeds, ItemId.PumpkinSeeds, ItemId.BakedPotato, ItemId.PumpkinPie,
  ] as const;
  const gallery = new THREE.Group();
  galleryItems.forEach((itemId, index) => {
    const model = itemVisuals.createItemModel(itemId);
    model.position.set(1.4 + (index % 7) * 2.05, surface + 1.65 + Math.floor(index / 7) * 1.45, 14.25);
    model.rotation.set(0.15, Math.PI, 0);
    model.scale.setScalar(1.15);
    gallery.add(model);
  });
  scene.add(gallery);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120);
  const look = new THREE.Vector3(8, surface + 0.8, 8);
  uiRoot.innerHTML = '<div style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:14px monospace;z-index:5">Farming QA · age 0→7 · wet/dry plots · attached stems</div>';

  const resize = (): void => {
    renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  let frame = 0;
  let angle = 0.25;
  const render = (): void => {
    world.processLighting(2, 8, 8);
    worldRenderer.rebuildDirty(2, 4, 8, 8, { requireNeighborLight: true });
    angle += 0.002;
    camera.position.set(look.x + Math.cos(angle) * 16, surface + 10, look.z + Math.sin(angle) * 16);
    camera.lookAt(look);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    worldRenderer.dispose();
    disposeWorldLighting(world);
    itemVisuals.dispose();
    atlas.dispose();
    renderer.dispose();
  };
}
