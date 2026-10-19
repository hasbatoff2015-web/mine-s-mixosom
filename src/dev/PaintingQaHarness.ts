import * as THREE from 'three';
import { BlockId, type HorizontalFacing } from '../blocks';
import { ItemId } from '../items';
import { ChunkMesher } from '../rendering/ChunkMesher';
import { PaintingRenderer } from '../rendering/PaintingRenderer';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { worldDaylightUniform } from '../rendering/worldLighting';
import { Chunk } from '../world/Chunk';
import { VoxelWorld } from '../world/World';

/**
 * Dev-only view of the production painting renderer.
 * These cells exist only in this throwaway scene. They are not worldgen.
 */
export async function startPaintingQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  const previousDaylight = worldDaylightUniform.value;
  worldDaylightUniform.value = 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const atlas = await TextureAtlas.create();
  const world = new VoxelWorld('painting-qa');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6e89a8);
  const paintings = new PaintingRenderer(world, () => true);
  scene.add(paintings.group);

  const row = [
    ItemId.Painting01VillagerHmm,
    ItemId.Painting02NightGuardian,
    ItemId.Painting03SunsetCat,
    ItemId.Painting04GrassCat,
    ItemId.Painting05DarkSteve,
    ItemId.Painting06GoldenCat,
    ItemId.Painting07SunnyBee,
    ItemId.Painting08Smirk,
    ItemId.Painting09RainbowGhast,
    ItemId.Painting10GiantZombie,
    ItemId.Painting11CrowdScream,
    ItemId.Painting12UnderwaterPatrick,
    ItemId.Painting13GucciCharacter,
    ItemId.Painting14MinecraftPortrait,
    ItemId.Painting15ConfidentBeard,
    ItemId.Painting16GrassSteve,
    ItemId.Painting17TrollSmile,
    ItemId.Painting18LynxRabbit,
    ItemId.Painting19BurningMask,
    ItemId.Painting20TigerMusya,
  ] as const;
  for (let index = 0; index < row.length; index += 1) {
    const x = index % 10;
    const y = index < 10 ? 40 : 42;
    hang(world, x, y, 6, 'south', row[index]!);
    world.setBlock(x, y, 5, BlockId.Stone);
    light(chunk, x, y, 6);
  }

  const faces: Array<{
    facing: HorizontalFacing;
    support: [number, number, number];
    cell: [number, number, number];
    itemId: string;
    position: [number, number, number];
    look: [number, number, number];
  }> = [
    {
      facing: 'south',
      support: [2, 48, 3],
      cell: [2, 48, 4],
      itemId: ItemId.Painting01VillagerHmm,
      position: [2.5, 48.55, 7.2],
      look: [2.5, 48.5, 4],
    },
    {
      facing: 'east',
      support: [6, 48, 8],
      cell: [7, 48, 8],
      itemId: ItemId.Painting03SunsetCat,
      position: [10.2, 48.55, 8.5],
      look: [7, 48.5, 8.5],
    },
    {
      facing: 'north',
      support: [11, 48, 4],
      cell: [11, 48, 3],
      itemId: ItemId.Painting09RainbowGhast,
      position: [11.5, 48.55, 0],
      look: [11.5, 48.5, 3],
    },
    {
      facing: 'west',
      support: [15, 48, 8],
      cell: [14, 48, 8],
      itemId: ItemId.Painting20TigerMusya,
      position: [11, 48.55, 8.5],
      look: [14, 48.5, 8.5],
    },
  ];
  for (const face of faces) {
    world.setBlock(...face.support, BlockId.Stone);
    hang(world, ...face.cell, face.facing, face.itemId);
    light(chunk, ...face.cell);
    light(chunk, ...face.support);
  }

  const material = new THREE.MeshBasicMaterial({
    map: atlas.texture,
    side: THREE.FrontSide,
  });
  const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
  const stone = new THREE.Mesh(meshed.opaque, material);
  scene.add(stone);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  const views: Record<string, { position: [number, number, number]; look: [number, number, number] }> = {
    row: { position: [4.5, 42.6, 16], look: [4.5, 41.2, 6] },
    south: { position: faces[0]!.position, look: faces[0]!.look },
    east: { position: faces[1]!.position, look: faces[1]!.look },
    north: { position: faces[2]!.position, look: faces[2]!.look },
    west: { position: faces[3]!.position, look: faces[3]!.look },
    oblique: { position: [4.6, 48.9, 6.5], look: [2.35, 48.45, 4.05] },
  };

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:14px monospace;z-index:5';
  panel.innerHTML = 'Painting QA · manual scene, not worldgen<br><select id="qa-painting-view"></select>';
  uiRoot.replaceChildren(panel);
  const select = panel.querySelector<HTMLSelectElement>('#qa-painting-view')!;
  for (const name of Object.keys(views)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  select.value = 'oblique';

  const applyView = (): void => {
    const view = views[select.value] ?? views.oblique!;
    camera.position.set(...view.position);
    camera.lookAt(...view.look);
  };
  const render = (): void => {
    renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
    paintings.sync();
    renderer.render(scene, camera);
  };
  let frame = 0;
  const loop = (): void => {
    frame = requestAnimationFrame(loop);
    render();
  };
  select.onchange = () => {
    applyView();
    render();
  };
  applyView();
  addEventListener('resize', render);
  loop();

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', render);
    select.onchange = null;
    paintings.dispose();
    meshed.opaque.dispose();
    material.dispose();
    renderer.dispose();
    worldDaylightUniform.value = previousDaylight;
  };
}

function hang(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  facing: HorizontalFacing,
  paintingItemId: string,
): void {
  world.setBlock(x, y, z, BlockId.CollectiblePainting);
  world.setBlockState(x, y, z, { attachment: 'wall', facing, paintingItemId });
}

function light(chunk: Chunk, x: number, y: number, z: number): void {
  chunk.skyLight[Chunk.index(x, y, z)] = 15;
}
