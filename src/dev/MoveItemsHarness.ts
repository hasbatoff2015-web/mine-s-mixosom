import * as THREE from 'three';
import { BlockId } from '../blocks';
import {
  ITEMS,
  classifyItemForRendering,
  type ItemDefinition,
  type ItemKind,
} from '../items';
import { DEFAULT_PLAYER_APPEARANCE } from '../player/appearance/PlayerAppearance';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { MinecraftSkinRegistry } from '../rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../rendering/player/PlayerSkinGeometry';
import { PlayerVisual, type PlayerVisualFrameState } from '../rendering/player/PlayerVisual';
import {
  ThirdPersonHeldItemCalibratorState,
  type ThirdPersonHeldItemTransform,
} from '../rendering/player/thirdPersonHeldItem';
import { setEntityLight } from '../rendering/worldLighting';
import { disposeWorldLighting } from '../world/LightEngine';
import { VoxelWorld } from '../world/World';
import { mountMoveItemsPanel, type MoveItemsCatalogGroup, type MoveItemsPanel } from './MoveItemsPanel';

const DEFAULT_ITEM = 'iron_pickaxe';
const FEATURED_IDS = [
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'ruby_pickaxe', 'titanium_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'ruby_axe', 'titanium_axe',
  'wooden_shovel', 'stone_shovel', 'iron_shovel', 'diamond_shovel', 'ruby_shovel', 'titanium_shovel',
  'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe', 'ruby_hoe', 'titanium_hoe',
  'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'ruby_sword', 'titanium_sword',
  'bow', 'stick', 'flint_and_steel', 'arrow', 'fire_arrow',
  'apple', 'totem_of_undying', 'coal', 'torch', 'stone', 'oak_planks',
] as const;

function catalogGroups(): MoveItemsCatalogGroup[] {
  const featured = new Set<string>(FEATURED_IDS);
  const byKind = new Map<ItemKind, string[]>();
  for (const item of ITEMS) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item.id);
    byKind.set(item.kind, list);
  }
  const kindLabel: Record<ItemKind, string> = {
    tool: 'Tools',
    weapon: 'Weapons',
    resource: 'Resources',
    food: 'Food',
    armor: 'Armor',
    block: 'Blocks',
  };
  const groups: MoveItemsCatalogGroup[] = [
    { label: 'Featured', ids: FEATURED_IDS.filter((id) => ITEMS.some((item) => item.id === id)) },
  ];
  for (const kind of ['tool', 'weapon', 'resource', 'food', 'armor', 'block'] as const) {
    const ids = (byKind.get(kind) ?? []).filter((id) => !featured.has(id) || kind === 'tool' || kind === 'weapon');
    if (ids.length > 0) groups.push({ label: kindLabel[kind], ids });
  }
  return groups;
}

function wrapDegrees(radians: number): number {
  let degrees = THREE.MathUtils.radToDeg(radians);
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  return degrees;
}

function flattenClearing(world: VoxelWorld, x: number, z: number, radius: number): number {
  const surface = world.surfaceY(x, z);
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      world.setBlock(x + dx, surface, z + dz, BlockId.GrassBlock);
      world.setBlock(x + dx, surface - 1, z + dz, BlockId.Dirt);
      for (let y = surface + 1; y <= surface + 6; y += 1) {
        world.setBlock(x + dx, y, z + dz, BlockId.Air);
      }
    }
  }
  return surface;
}

export async function startMoveItemsHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x83b9d8);
  scene.fog = new THREE.Fog(0x83b9d8, 18, 42);
  scene.add(new THREE.HemisphereLight(0xb7d7f2, 0x1a1612, 0.46));
  const sun = new THREE.DirectionalLight(0xffe2b3, 1.73);
  sun.position.set(40, 70, 25);
  scene.add(sun);

  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const items = new ItemVisualFactory({ atlas });
  await items.preload();
  const world = new VoxelWorld('moveitems');
  const originX = 8;
  const originZ = 8;
  world.ensureChunks(originX, originZ, 2, 25);
  world.setViewCenter(originX, originZ, 1);
  world.deferredLighting = true;
  const surface = flattenClearing(world, originX, originZ, 5);
  const worldRenderer = new WorldRenderer(world, atlas);
  worldRenderer.setDaylight(1);
  scene.add(worldRenderer.group);

  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const player = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
  const playerX = originX + 0.5;
  const playerY = surface + 1;
  const playerZ = originZ + 0.5;
  player.root.position.set(playerX, playerY, playerZ);
  scene.add(player.root);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 80);
  // Front three-quarter on the player's right hand (held-item socket).
  let cameraOrbit = Math.PI + 0.55;
  let cameraPitch = 0.18;
  let cameraDistance = 3.4;
  let dragging = false;
  let lastPointer = { x: 0, y: 0 };

  const catalog = catalogGroups();
  const catalogIds = catalog.flatMap((group) => [...group.ids]);
  const state = new ThirdPersonHeldItemCalibratorState();
  let currentItem = catalogIds.includes(DEFAULT_ITEM) ? DEFAULT_ITEM : catalogIds[0]!;
  let pose: 'idle' | 'walk' | 'mining' = 'idle';
  const playerState: PlayerVisualFrameState = {
    viewYaw: 0, viewPitch: 0, movementSpeed: 0, onGround: true, sneaking: false,
    sprinting: false, verticalVelocity: 0, mining: false, bowCharge: 0,
    swordBlocking: false, foodUseProgress: 0, invisible: false, hurtFlash: 0,
  };

  const applyItem = (itemId: string, transform: ThirdPersonHeldItemTransform): void => {
    player.setHeldItem(itemId);
    player.applyHeldItemCalibration(transform);
  };

  applyItem(currentItem, state.remember(currentItem));

  const getTransform = (): ThirdPersonHeldItemTransform => state.get(currentItem);
  let panel!: MoveItemsPanel;
  const applyLive = (transform: ThirdPersonHeldItemTransform): void => {
    state.set(currentItem, transform);
    player.applyHeldItemCalibration(transform);
    panel.sync();
  };

  uiRoot.innerHTML = `<div id="moveitems-hud" style="position:fixed;left:12px;top:12px;z-index:20;width:min(280px,calc(100vw - 24px));padding:10px 12px;background:#10151de8;color:#fff;font:12px/1.35 monospace;pointer-events:auto;border:1px solid #ffffff35;border-radius:8px">
    <strong>/moveitems · remote held item</strong>
    <div style="opacity:0.75;margin:6px 0 8px">Uses PlayerVisual + ItemVisualFactory (same path as RemotePlayerView). First-person pose is not changed.</div>
    <label style="display:grid;grid-template-columns:72px 1fr;gap:6px;align-items:center;margin:0 0 6px">pose
      <select id="moveitems-pose"><option value="idle">idle</option><option value="walk">walk</option><option value="mining">mining</option></select>
    </label>
    <label style="display:grid;grid-template-columns:72px 1fr;gap:6px;align-items:center;margin:0 0 6px">orbit
      <input id="moveitems-orbit" type="range" min="-180" max="180" value="${Math.round(wrapDegrees(cameraOrbit))}">
    </label>
    <label style="display:grid;grid-template-columns:72px 1fr;gap:6px;align-items:center;margin:0 0 6px">pitch
      <input id="moveitems-pitch" type="range" min="-35" max="70" value="${Math.round(cameraPitch * 180 / Math.PI)}">
    </label>
    <label style="display:grid;grid-template-columns:72px 1fr;gap:6px;align-items:center">distance
      <input id="moveitems-distance" type="range" min="1.6" max="12" step="0.1" value="${cameraDistance}">
    </label>
  </div>`;
  const hud = uiRoot.querySelector<HTMLElement>('#moveitems-hud')!;
  const poseSelect = hud.querySelector<HTMLSelectElement>('#moveitems-pose')!;
  const orbitInput = hud.querySelector<HTMLInputElement>('#moveitems-orbit')!;
  const pitchInput = hud.querySelector<HTMLInputElement>('#moveitems-pitch')!;
  const distanceInput = hud.querySelector<HTMLInputElement>('#moveitems-distance')!;
  poseSelect.addEventListener('change', () => { pose = poseSelect.value as typeof pose; });
  orbitInput.addEventListener('input', () => { cameraOrbit = THREE.MathUtils.degToRad(Number(orbitInput.value)); });
  pitchInput.addEventListener('input', () => { cameraPitch = THREE.MathUtils.degToRad(Number(pitchInput.value)); });
  distanceInput.addEventListener('input', () => { cameraDistance = Number(distanceInput.value); });

  panel = mountMoveItemsPanel({
    catalog,
    getItemId: () => currentItem,
    getTransform,
    getCategory: () => classifyItemForRendering(currentItem),
    onSelectItem: (itemId) => {
      currentItem = itemId;
      applyItem(itemId, state.remember(itemId));
      panel.sync();
    },
    onChange: applyLive,
    onReset: () => applyLive(state.reset(currentItem)),
    getCopyAllEntries: () => {
      const stored = state.entries();
      return stored.length > 0 ? stored : [{ itemId: currentItem, transform: getTransform() }];
    },
  });
  uiRoot.append(panel.element);

  const lookAt = new THREE.Vector3(playerX, playerY + 1.05, playerZ);
  const placeCamera = (): void => {
    const horizontal = Math.cos(cameraPitch) * cameraDistance;
    camera.position.set(
      lookAt.x + Math.sin(cameraOrbit) * horizontal,
      lookAt.y + Math.sin(cameraPitch) * cameraDistance,
      lookAt.z + Math.cos(cameraOrbit) * horizontal,
    );
    camera.lookAt(lookAt);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target !== canvas) return;
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    cameraOrbit -= dx * 0.008;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.006, -0.6, 1.2);
    orbitInput.value = String(Math.round(wrapDegrees(cameraOrbit)));
    pitchInput.value = String(Math.round(THREE.MathUtils.radToDeg(cameraPitch)));
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };
  const onWheel = (event: WheelEvent): void => {
    if (event.target !== canvas && !(event.target instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    cameraDistance = THREE.MathUtils.clamp(cameraDistance + Math.sign(event.deltaY) * 0.35, 1.6, 12);
    distanceInput.value = String(cameraDistance);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

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
  let previous = performance.now();
  const render = (now: number): void => {
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    Object.assign(playerState, {
      movementSpeed: pose === 'walk' ? 3.1 : 0,
      mining: pose === 'mining',
    });
    player.update(delta, playerState);
    setEntityLight(player.root, [1, 1, 1]);
    world.processLighting(2, originX, originZ);
    worldRenderer.rebuildDirty(2, 4, originX, originZ, { requireNeighborLight: true });
    placeCamera();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    panel.dispose();
    player.dispose();
    geometries.dispose();
    skins.dispose();
    items.dispose();
    worldRenderer.dispose();
    disposeWorldLighting(world);
    atlas.dispose();
    renderer.dispose();
  };
}

export function featuredMoveItems(items: readonly ItemDefinition[] = ITEMS): readonly string[] {
  return FEATURED_IDS.filter((id) => items.some((item) => item.id === id));
}
