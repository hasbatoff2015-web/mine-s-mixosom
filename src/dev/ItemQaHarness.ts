import * as THREE from 'three';
import {
  getItemDefinition,
  isKnownItemId,
  itemRenderProfile,
  itemUsesGeneratedHeldGeometry,
} from '../items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../rendering/FirstPersonRenderer';
import {
  attachGeneratedItemSideDebug,
  formatGeneratedItemDiagnostics,
  generatedItemInfo,
} from '../rendering/GeneratedItemGeometry';
import {
  formatHeldItemQaQuery,
  heldItemQaValuesFromTransform,
  parseHeldItemQaOverride,
  parseItemQaSideDebug,
  parseItemQaView,
  resolveHeldItemTransform,
  type ItemQaView,
} from '../rendering/heldItemQa';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';

export type ItemQaMode = 'empty' | 'drops' | string;

const INSPECT_FRUSTUM = 1.25;
const INSPECT_CAMERA: Readonly<Record<Exclude<ItemQaView, 'held'>, readonly [number, number, number]>> = {
  front: [0, 0, 2.15],
  back: [0, 0, -2.15],
  left: [-0.78, 0.06, 2.02],
  right: [0.78, 0.06, 2.02],
};

export async function startItemQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  mode: ItemQaMode,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const search = new URLSearchParams(location.search);
  const qaView = parseItemQaView(search);
  const sideDebug = parseItemQaSideDebug(search);
  const inspect = mode !== 'drops' && qaView !== 'held';
  scene.background = new THREE.Color(inspect ? 0x1b1d22 : 0x80b5d4);
  const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = inspect
    ? new THREE.OrthographicCamera(-INSPECT_FRUSTUM, INSPECT_FRUSTUM, INSPECT_FRUSTUM, -INSPECT_FRUSTUM, 0.05, 50)
    : new THREE.PerspectiveCamera(55, 1, 0.05, 50);
  if (!inspect) {
    camera.position.set(0, 2.2, 5.2);
    camera.lookAt(0, 0.8, 0);
  }
  if (!inspect) {
    scene.add(new THREE.HemisphereLight(0xe7f3ff, 0x4c4233, 1.55));
    const light = new THREE.DirectionalLight(0xffe5be, 2);
    light.position.set(-3, 6, 4);
    scene.add(light);
  }
  const ground = inspect ? undefined : new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshLambertMaterial({ color: 0x668a4e }),
  );
  if (ground) {
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
  }
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const visuals = new ItemVisualFactory({ atlas });
  await visuals.preload();
  const viewmodel = inspect ? undefined : new FirstPersonRenderer(visuals);
  const dropped: THREE.Group[] = [];
  const extraDispose: Array<() => void> = [];
  const qaItem = mode !== 'empty' && mode !== 'drops' && isKnownItemId(mode) ? mode : undefined;
  const requestedPose = search.get('pose');
  const heldQa = parseHeldItemQaOverride(search);
  const heldBase = itemRenderProfile(qaItem ?? 'coal').transforms.firstPersonRightHand;
  const heldResolved = resolveHeldItemTransform(heldBase, heldQa);
  const heldQuery = formatHeldItemQaQuery(heldItemQaValuesFromTransform(heldResolved));
  let geometryOverlay = '';

  if (mode === 'drops') {
    const samples = [
      ['apple', 1], ['feather', 2], ['coal', 18], ['stick', 33], ['stone', 1],
    ] as const;
    samples.forEach(([itemId, count], index) => {
      const visual = visuals.createDroppedItemVisual(itemId, count);
      visual.position.set((index - 2) * 1.25, 0.48, 0);
      visual.userData.phase = index * 0.83;
      scene.add(visual);
      dropped.push(visual);
    });
  } else if (inspect && qaItem) {
    geometryOverlay = mountInspectItem({
      scene,
      camera,
      visuals,
      itemId: qaItem,
      view: qaView,
      sideDebug,
      extraDispose,
    });
  } else {
    viewmodel?.setHeldItems(qaItem);
    if (qaItem && itemUsesGeneratedHeldGeometry(qaItem)) {
      const texturePath = getItemDefinition(qaItem).texture;
      const geometry = visuals.getGeneratedGeometry(texturePath);
      if (geometry) geometryOverlay = formatGeneratedItemDiagnostics(generatedItemInfo(geometry), qaItem);
    }
  }

  if (geometryOverlay) console.info(`[item-geom]\n${geometryOverlay}`);
  if (!inspect) console.info(`[held-qa] ?qaItem=${mode}&qaView=held&${heldQuery}&pose=idle`);

  const overlayLines = [
    `item QA · ${mode}`,
    inspect ? `qaView=${qaView}${sideDebug ? '  qaSideDebug=1' : ''}` : `qaView=held  pose=${requestedPose ?? 'idle'}`,
    inspect
      ? (sideDebug ? 'UP red  DOWN green  LEFT blue  RIGHT yellow' : 'isolated inspect · no bob/swing')
      : heldQuery,
    inspect && heldQa ? 'held* ignored here · add qaView=held' : '',
    geometryOverlay,
  ].filter(Boolean);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:13px/1.35 monospace;z-index:5;white-space:pre">${overlayLines.join('\n')}</div>`;
  const label = uiRoot.querySelector('#qa-label');
  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    if (camera instanceof THREE.OrthographicCamera) {
      const aspect = width / height;
      camera.left = -INSPECT_FRUSTUM * aspect;
      camera.right = INSPECT_FRUSTUM * aspect;
      camera.top = INSPECT_FRUSTUM;
      camera.bottom = -INSPECT_FRUSTUM;
    } else {
      camera.aspect = width / height;
    }
    camera.updateProjectionMatrix();
    viewmodel?.resize(width, height);
  };
  resize();
  addEventListener('resize', resize);

  const state: FirstPersonFrameState = {
    visible: mode !== 'drops' && !inspect, movementSpeed: 0, onGround: true, sprinting: false,
    mining: false, foodUseProgress: 0, bowCharge: 0, shieldRaised: false,
  };
  let frame = 0;
  let previous = performance.now();
  let elapsed = 0;
  const render = (now: number): void => {
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    elapsed += delta;
    if (mode === 'drops') {
      dropped.forEach((visual) => {
        const phase = Number(visual.userData.phase ?? 0);
        visual.rotation.y = elapsed * 1.15 + phase;
        visual.position.y = 0.48 + Math.sin(elapsed * 2.2 + phase) * 0.06;
      });
    } else if (!inspect && viewmodel) {
      state.movementSpeed = requestedPose === 'walk' ? 1.8 : 0;
      state.foodUseProgress = qaItem === 'apple' && requestedPose === 'eat' ? (elapsed % 2.2) / 2.2 : 0;
      state.bowCharge = qaItem === 'bow'
        ? requestedPose === 'partial' ? 0.5 : requestedPose === 'full' ? 1 : requestedPose === 'base' || !requestedPose ? 0 : (elapsed % 2.2) / 2.2
        : 0;
      state.shieldRaised = qaItem === 'shield' && requestedPose !== 'idle';
      viewmodel.update(delta, state);
      const facing = viewmodel.measureHeldFrontCameraDot();
      if (label && facing !== undefined) {
        label.textContent = `${overlayLines.join('\n')}\nfront·camera ${facing.toFixed(4)}`;
      }
    }
    renderer.render(scene, camera);
    if (!inspect && mode !== 'drops') viewmodel?.render(renderer);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    extraDispose.forEach((dispose) => dispose());
    viewmodel?.dispose();
    visuals.dispose();
    atlas.dispose();
    ground?.geometry.dispose();
    if (ground) (ground.material as THREE.Material).dispose();
    renderer.dispose();
  };
}

function mountInspectItem(options: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  visuals: ItemVisualFactory;
  itemId: string;
  view: Exclude<ItemQaView, 'held'>;
  sideDebug: boolean;
  extraDispose: Array<() => void>;
}): string {
  const { scene, camera, visuals, itemId, view, sideDebug, extraDispose } = options;
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ color: 0x2a3038, fog: false }),
  );
  backdrop.position.z = view === 'back' ? 2.4 : -2.4;
  if (view === 'back') backdrop.rotation.y = Math.PI;
  scene.add(backdrop);
  extraDispose.push(() => {
    backdrop.geometry.dispose();
    (backdrop.material as THREE.Material).dispose();
  });

  camera.position.set(...INSPECT_CAMERA[view]);
  camera.lookAt(0, 0, 0);

  const model = visuals.createItemModel(itemId);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1.55);
  scene.add(model);

  const mesh = model.children[0];
  if (!(mesh instanceof THREE.Mesh) || !itemUsesGeneratedHeldGeometry(itemId)) {
    return `item ${itemId}\nnot generated sprite geometry`;
  }

  const texturePath = getItemDefinition(itemId).texture;
  const mask = visuals.getGeneratedMask(texturePath);
  const source = visuals.getGeneratedGeometry(texturePath) ?? mesh.geometry;
  let info = generatedItemInfo(source);
  if (sideDebug && mask) {
    const debugGeometry = attachGeneratedItemSideDebug(mesh, mask);
    info = generatedItemInfo(debugGeometry);
    extraDispose.push(() => {
      debugGeometry.dispose();
      const materials = mesh.material;
      if (Array.isArray(materials)) {
        for (const material of materials) material.dispose();
      }
    });
  }
  return formatGeneratedItemDiagnostics(info, itemId);
}
