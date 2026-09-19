import * as THREE from 'three';
import { BlockId, type HorizontalFacing, type RailShape } from '../blocks';
import { CHUNK_SIZE, FIXED_DT, chunkKey } from '../core/constants';
import { MINECART_MAX_SPEED, MinecartManager } from '../entities/MinecartManager';
import { ThreeEntityHost } from '../entities/ThreeEntityHost';
import { toggleDoorState } from '../gameplay/useInteraction';
import { DEFAULT_PLAYER_APPEARANCE } from '../player/appearance/PlayerAppearance';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { MinecraftSkinRegistry } from '../rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../rendering/player/PlayerVisual';
import { applySeatVisualRoot, MINECART_RIDER_GAMEPLAY_Y } from '../rendering/player/seatVisual';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { Chunk } from '../world/Chunk';
import { disposeWorldLighting } from '../world/LightEngine';
import { VoxelWorld } from '../world/World';

type RailQaRow = 'all' | 'flat' | 'slope' | 'tracks';

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
  const row: RailQaRow = requestedRow === 'flat' || requestedRow === 'slope' || requestedRow === 'tracks'
    ? requestedRow
    : 'all';
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:13px/1.4 monospace;z-index:5;white-space:pre">${
    row === 'tracks'
      ? 'RAIL TRACK QA · straight → corner → straight\nNE · NW · SE · SW with moving minecarts'
      : `RAIL QA · production WorldRenderer · ${row}\nflat: NS · EW · NE · NW · SE · SW\nslope: N · S · E · W carts pitched along the rail`
  }</div>`;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x90b9cf);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 100);
  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  renderer.render(scene, camera);
  const world = row === 'tracks' ? createRailTrackQaWorld() : createRailQaWorld();
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);

  const view = row === 'flat'
    ? { position: [15, 45, 20] as const, look: [15, 40, 7] as const }
    : row === 'slope'
      ? { position: [15, 45, 27] as const, look: [15, 40.3, 17] as const }
      : row === 'tracks'
        ? { position: [10, 44, 18] as const, look: [9, 40.1, 10] as const }
        : { position: [15, 52, 37] as const, look: [15, 40, 12] as const };
  camera.position.set(view.position[0], view.position[1], view.position[2]);
  camera.lookAt(view.look[0], view.look[1], view.look[2]);

  let carts: MinecartManager | undefined;
  let entityHost: ThreeEntityHost | undefined;
  let frame = 0;
  let previous = performance.now();
  let leftover = 0;
  const render = (now: number): void => {
    const delta = Math.min(0.25, Math.max(0, (now - previous) / 1000));
    previous = now;
    leftover += delta;
    world.processLighting(3, 15, 12);
    worldRenderer.rebuildDirty(4, 8, 15, 12, { requireNeighborLight: false });
    while (leftover >= FIXED_DT) {
      carts?.update(FIXED_DT);
      leftover -= FIXED_DT;
    }
    carts?.interpolateVisuals(leftover / FIXED_DT);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  if (row === 'tracks' || row === 'slope') {
    const items = new ItemVisualFactory({ atlas });
    entityHost = new ThreeEntityHost(scene, { itemVisuals: items, ownsItemVisuals: true });
    carts = new MinecartManager(entityHost, world);
    if (row === 'tracks') spawnTrackCarts(carts);
    else spawnSlopeCarts(carts);
  }

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    carts?.dispose();
    entityHost?.dispose();
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

function createStoneQaWorld(name: string): VoxelWorld {
  const world = new VoxelWorld(name);
  for (let chunkZ = 0; chunkZ <= 1; chunkZ += 1) {
    for (let chunkX = 0; chunkX <= 1; chunkX += 1) {
      const chunk = new Chunk(chunkX, chunkZ);
      chunk.generated = true;
      const start = 39 * CHUNK_SIZE * CHUNK_SIZE;
      chunk.blocks.fill(BlockId.Stone, start, start + CHUNK_SIZE * CHUNK_SIZE);
      chunk.occupancyTop = 39;
      chunk.surfaceHeights.fill(39);
      world.chunks.set(chunkKey(chunkX, chunkZ), chunk);
    }
  }
  world.setViewCenter(12, 10, 1);
  world.deferredLighting = true;
  return world;
}

function writeQaRail(world: VoxelWorld, x: number, z: number, shape: RailShape): void {
  world.setBlock(x, 40, z, BlockId.Rail, false);
  world.setBlockState(x, 40, z, { railShape: shape });
}

function createRailTrackQaWorld(): VoxelWorld {
  const world = createStoneQaWorld('rail-track-qa');
  // NE: south NS → corner → east EW
  writeQaRail(world, 4, 4, 'north_south');
  writeQaRail(world, 4, 5, 'north_south');
  writeQaRail(world, 4, 6, 'north_east');
  writeQaRail(world, 5, 6, 'east_west');
  writeQaRail(world, 6, 6, 'east_west');
  // NW
  writeQaRail(world, 14, 4, 'north_south');
  writeQaRail(world, 14, 5, 'north_south');
  writeQaRail(world, 14, 6, 'north_west');
  writeQaRail(world, 13, 6, 'east_west');
  writeQaRail(world, 12, 6, 'east_west');
  // SE
  writeQaRail(world, 4, 16, 'north_south');
  writeQaRail(world, 4, 15, 'north_south');
  writeQaRail(world, 4, 14, 'south_east');
  writeQaRail(world, 5, 14, 'east_west');
  writeQaRail(world, 6, 14, 'east_west');
  // SW
  writeQaRail(world, 14, 16, 'north_south');
  writeQaRail(world, 14, 15, 'north_south');
  writeQaRail(world, 14, 14, 'south_west');
  writeQaRail(world, 13, 14, 'east_west');
  writeQaRail(world, 12, 14, 'east_west');
  return world;
}

function spawnTrackCarts(manager: MinecartManager): void {
  const north = manager.spawn(4, 40, 4);
  if (north) north.alongSpeed = MINECART_MAX_SPEED;
  const northWest = manager.spawn(14, 40, 4);
  if (northWest) northWest.alongSpeed = MINECART_MAX_SPEED;
  const south = manager.spawn(4, 40, 16);
  if (south) south.alongSpeed = -MINECART_MAX_SPEED;
  const southWest = manager.spawn(14, 40, 16);
  if (southWest) southWest.alongSpeed = -MINECART_MAX_SPEED;
}

function spawnSlopeCarts(manager: MinecartManager): void {
  const totalWidth = (SLOPE_SHAPES.length - 1) * 5;
  const startX = Math.round(15 - totalWidth / 2);
  SLOPE_SHAPES.forEach((_, index) => {
    const cart = manager.spawn(startX + index * 5, 40, 17);
    if (cart) cart.alongSpeed = 0;
  });
}

export async function startDoorQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:13px/1.4 monospace;z-index:5;white-space:pre">DOOR QA · facing = closed outward normal
front row closed · back row open · hinge left as seen from outside
N · S · E · W    Space toggles every door</div>`;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb4c8);
  const world = createStoneQaWorld('door-qa');
  const facings: readonly HorizontalFacing[] = ['north', 'south', 'east', 'west'];
  facings.forEach((facing, index) => {
    const x = 6 + index * 4;
    world.setBlock(x, 40, 8, BlockId.OakDoor, false);
    world.setBlock(x, 41, 8, BlockId.OakDoor, false);
    world.setBlockState(x, 40, 8, { facing, hinge: 'left', open: false, half: 'lower' });
    world.setBlockState(x, 41, 8, { facing, hinge: 'left', open: false, half: 'upper' });
    world.setBlock(x, 40, 12, BlockId.OakDoor, false);
    world.setBlock(x, 41, 12, BlockId.OakDoor, false);
    world.setBlockState(x, 40, 12, { facing, hinge: 'left', open: true, half: 'lower' });
    world.setBlockState(x, 41, 12, { facing, hinge: 'left', open: true, half: 'upper' });
  });
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 100);
  camera.position.set(12, 46, 22);
  camera.lookAt(12, 41, 10);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:13px/1.4 monospace;z-index:5;white-space:pre">DOOR QA · facing = closed outward normal
front row closed · back row open · hinge left as seen from outside
N · S · E · W    Space toggles every door</div>`;
  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || event.repeat) return;
    event.preventDefault();
    facings.forEach((_, index) => {
      const x = 6 + index * 4;
      toggleDoorState(world, x, 40, 8);
      toggleDoorState(world, x, 40, 12);
    });
  };
  addEventListener('keydown', onKey);
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
    removeEventListener('keydown', onKey);
    worldRenderer.dispose();
    disposeWorldLighting(world);
    atlas.dispose();
    renderer.dispose();
  };
}

export async function startSeatedCartQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:13px/1.4 monospace;z-index:5;white-space:pre">SEATED CART QA · side + slightly above
torso upright · hip 90° · straight legs forward · pelvis toward rear wall</div>`;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x769fba);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 80);
  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  const world = createStoneQaWorld('seated-cart-qa');
  for (let z = 6; z <= 12; z += 1) writeQaRail(world, 8, z, 'north_south');
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const worldRenderer = new WorldRenderer(world, atlas, (x, y, z) => world.getBlockState(x, y, z));
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);
  const playerState = {
    viewYaw: 0,
    viewPitch: 0,
    movementSpeed: 2,
    onGround: true,
    sneaking: false,
    sprinting: false,
    verticalVelocity: 0,
    mining: false,
    bowCharge: 0,
    swordBlocking: false,
    foodUseProgress: 0,
    seated: true,
    invisible: false,
    hurtFlash: 0,
  };
  let carts: MinecartManager | undefined;
  let entityHost: ThreeEntityHost | undefined;
  let cart: ReturnType<MinecartManager['spawn']>;
  let player: PlayerVisual | undefined;
  let frame = 0;
  let previous = performance.now();
  const render = (now: number): void => {
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    world.processLighting(3, 15, 12);
    worldRenderer.rebuildDirty(4, 8, 15, 12, { requireNeighborLight: false });
    carts?.update(delta);
    const seat = cart ?? { position: { x: 8.5, y: 40, z: 8.5 }, yaw: 0 };
    const yaw = 'yaw' in seat ? seat.yaw : 0;
    if (player) {
      playerState.viewYaw = yaw;
      const pose = player.update(delta, playerState);
      applySeatVisualRoot(
        player.root,
        { x: seat.position.x, y: seat.position.y + MINECART_RIDER_GAMEPLAY_Y, z: seat.position.z },
        pose.bodyYaw,
        true,
      );
    }
    camera.position.set(seat.position.x + 3.4, seat.position.y + 1.55, seat.position.z + 1.2);
    camera.lookAt(seat.position.x, seat.position.y + 0.55, seat.position.z);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  const items = new ItemVisualFactory({ atlas });
  entityHost = new ThreeEntityHost(scene, { itemVisuals: items, ownsItemVisuals: false });
  carts = new MinecartManager(entityHost, world);
  cart = carts.spawn(8, 40, 8);
  if (cart) cart.alongSpeed = 0;
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  player = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
  player.animator.reset(0);
  scene.add(player.root);
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    player?.dispose();
    geometries.dispose();
    skins.dispose();
    carts?.dispose();
    entityHost?.dispose();
    worldRenderer.dispose();
    disposeWorldLighting(world);
    items.dispose();
    atlas.dispose();
    renderer.dispose();
  };
}
