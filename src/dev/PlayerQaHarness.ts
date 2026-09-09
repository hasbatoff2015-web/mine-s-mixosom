import * as THREE from 'three';
import {
  ALL_PLAYER_SKIN_LAYERS,
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
  type PlayerModelVariant,
  type PlayerSkinLayers,
} from '../player/appearance/PlayerAppearance';
import {
  BUILTIN_MINECRAFT_SKINS,
  MinecraftSkinRegistry,
} from '../rendering/player/MinecraftSkin';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { PlayerSkinGeometryCache } from '../rendering/player/PlayerSkinGeometry';
import { PlayerVisual, type PlayerVisualFrameState } from '../rendering/player/PlayerVisual';
import {
  ARMOR_VISUAL_MATERIALS,
  PlayerArmorGeometryCache,
  PlayerArmorMaterialCache,
  armorVisualItemId,
} from '../rendering/player/PlayerArmorVisual';
import { nextCameraPerspective, type CameraPerspective } from '../rendering/player/ThirdPersonCamera';
import { setEntityLight } from '../rendering/worldLighting';
import type { PlayerEquipmentState } from '../../shared/protocol';
import type { ArmorSlot } from '../items';

type QaPose = 'idle' | 'walk' | 'sprint' | 'sneak' | 'jump' | 'attack' | 'mining' | 'bow' | 'block' | 'eat';

const QA_ITEMS = Object.freeze({
  none: '',
  sword: 'diamond_sword',
  pickaxe: 'iron_pickaxe',
  block: 'stone',
  bow: 'bow',
  food: 'apple',
});

const QA_ARMOR_SLOT_NAMES: Readonly<Record<ArmorSlot, string>> = Object.freeze({
  head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots',
});

const QA_SKIN_LAYER_LABELS: Readonly<Record<keyof PlayerSkinLayers, string>> = Object.freeze({
  hat: 'hat',
  jacket: 'jacket',
  rightSleeve: 'right sleeve',
  leftSleeve: 'left sleeve',
  rightPants: 'right pants',
  leftPants: 'left pants',
});

function armorOptions(slot: ArmorSlot, selected: string | null): string {
  return [
    `<option value="">none</option>`,
    ...ARMOR_VISUAL_MATERIALS.map((material) => {
      const id = armorVisualItemId(material, slot);
      return `<option value="${id}"${id === selected ? ' selected' : ''}>${material}</option>`;
    }),
  ].join('');
}

export async function startPlayerQaHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x769fba);
  scene.fog = new THREE.Fog(0x769fba, 8, 20);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 30);
  scene.add(new THREE.HemisphereLight(0xe9f5ff, 0x44382e, 1.55));
  const key = new THREE.DirectionalLight(0xffe4bd, 2.15);
  key.position.set(-4, 7, -5);
  scene.add(key);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshLambertMaterial({ color: 0x55764c }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const items = new ItemVisualFactory({ atlas });
  await items.preload();
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const armorMaterials = new PlayerArmorMaterialCache();
  const armorGeometries = new PlayerArmorGeometryCache();
  const armorResources = { materials: armorMaterials, geometries: armorGeometries };
  let appearance = DEFAULT_PLAYER_APPEARANCE;
  const player = new PlayerVisual(skins, geometries, items, appearance, { armorResources });
  scene.add(player.root);
  const firstPerson = new FirstPersonRenderer(items, {
    skinRegistry: skins,
    skinGeometries: geometries,
    appearance,
    onSwing: () => player.swing(),
  });

  let perspective: CameraPerspective = 'thirdPersonFront';
  let pose: QaPose = 'idle';
  let heldItem = '';
  const layers: { -readonly [K in keyof PlayerSkinLayers]: boolean } = { ...ALL_PLAYER_SKIN_LAYERS };
  let invisible = false;
  let hurt = false;
  let viewYaw = 0;
  let viewPitch = 0;
  let lastAttack = 0;
  const equipment: { -readonly [K in keyof PlayerEquipmentState]: PlayerEquipmentState[K] } = {
    head: 'iron_helmet',
    chest: 'iron_chestplate',
    legs: 'iron_leggings',
    feet: 'iron_boots',
  };
  player.setArmor(equipment);

  uiRoot.innerHTML = `<div id="player-qa" style="position:fixed;left:12px;top:12px;z-index:20;width:min(470px,calc(100vw - 24px));padding:12px;background:#10151de8;color:#fff;font:12px/1.35 monospace;pointer-events:auto;border:1px solid #ffffff35">
    <strong>PLAYER QA · 64×64 / Classic + Slim / shared held items</strong>
    <div style="display:grid;grid-template-columns:90px 1fr;gap:6px;margin-top:10px;align-items:center">
      <label for="qa-skin">skin</label><select id="qa-skin">${BUILTIN_MINECRAFT_SKINS.map((skin) => `<option value="${skin.id}"${skin.id === appearance.skinId ? ' selected' : ''}>${skin.id} · ${skin.defaultModel}</option>`).join('')}</select>
      <label for="qa-model">model</label><select id="qa-model"><option>classic</option><option>slim</option></select>
      <label for="qa-pose">pose</label><select id="qa-pose">${(['idle', 'walk', 'sprint', 'sneak', 'jump', 'attack', 'mining', 'bow', 'block', 'eat'] as QaPose[]).map((name) => `<option>${name}</option>`).join('')}</select>
      <label for="qa-held">held</label><select id="qa-held">${Object.entries(QA_ITEMS).map(([name, id]) => `<option value="${id}">${name}</option>`).join('')}</select>
      <label for="qa-armor-head">helmet</label><select id="qa-armor-head">${armorOptions('head', equipment.head)}</select>
      <label for="qa-armor-chest">chestplate</label><select id="qa-armor-chest">${armorOptions('chest', equipment.chest)}</select>
      <label for="qa-armor-legs">leggings</label><select id="qa-armor-legs">${armorOptions('legs', equipment.legs)}</select>
      <label for="qa-armor-feet">boots</label><select id="qa-armor-feet">${armorOptions('feet', equipment.feet)}</select>
      <label for="qa-yaw">head yaw</label><input id="qa-yaw" type="range" min="-120" max="120" value="0">
      <label for="qa-pitch">head pitch</label><input id="qa-pitch" type="range" min="-80" max="80" value="0">
    </div>
    <div style="margin-top:8px"><button data-camera="firstPerson">first</button> <button data-camera="thirdPersonBack">back</button> <button data-camera="thirdPersonFront">front</button> <button data-toggle="hurt">hurt off</button> <button data-toggle="invisible">invis off</button></div>
    <div style="margin-top:6px">${Object.entries(QA_SKIN_LAYER_LABELS).map(([layer, label]) => `<button data-layer="${layer}">${label} on</button>`).join(' ')}</div>
    <output style="display:block;margin-top:8px;white-space:pre"></output>
  </div>`;
  const root = uiRoot.querySelector<HTMLElement>('#player-qa')!;
  const skinSelect = root.querySelector<HTMLSelectElement>('#qa-skin')!;
  const modelSelect = root.querySelector<HTMLSelectElement>('#qa-model')!;
  const poseSelect = root.querySelector<HTMLSelectElement>('#qa-pose')!;
  const heldSelect = root.querySelector<HTMLSelectElement>('#qa-held')!;
  const yawInput = root.querySelector<HTMLInputElement>('#qa-yaw')!;
  const pitchInput = root.querySelector<HTMLInputElement>('#qa-pitch')!;
  const armorSelects = (Object.keys(QA_ARMOR_SLOT_NAMES) as ArmorSlot[]).map((slot) => ({
    slot,
    select: root.querySelector<HTMLSelectElement>(`#qa-armor-${slot}`)!,
  }));
  const output = root.querySelector<HTMLOutputElement>('output')!;
  modelSelect.value = appearance.model;

  const applyAppearance = (): void => {
    appearance = createPlayerAppearance({
      skinId: skinSelect.value,
      model: modelSelect.value as PlayerModelVariant,
      layers,
    });
    player.setAppearance(appearance);
    firstPerson.setAppearance(appearance);
  };
  skinSelect.addEventListener('change', () => {
    const descriptor = BUILTIN_MINECRAFT_SKINS.find((skin) => skin.id === skinSelect.value);
    modelSelect.value = descriptor?.defaultModel ?? 'classic';
    applyAppearance();
  });
  modelSelect.addEventListener('change', applyAppearance);
  poseSelect.addEventListener('change', () => {
    pose = poseSelect.value as QaPose;
    if (pose === 'attack') player.swing();
  });
  heldSelect.addEventListener('change', () => {
    heldItem = heldSelect.value;
    player.setHeldItem(heldItem || undefined);
    firstPerson.setHeldItems(heldItem || undefined);
  });
  for (const { slot, select } of armorSelects) {
    select.addEventListener('change', () => {
      equipment[slot] = select.value || null;
      player.setArmor(equipment);
    });
  }
  yawInput.addEventListener('input', () => { viewYaw = THREE.MathUtils.degToRad(Number(yawInput.value)); });
  pitchInput.addEventListener('input', () => { viewPitch = THREE.MathUtils.degToRad(Number(pitchInput.value)); });
  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const cameraMode = target.dataset.camera as CameraPerspective | undefined;
    if (cameraMode) perspective = cameraMode;
    const layer = target.dataset.layer as keyof PlayerSkinLayers | undefined;
    if (layer && layer in layers) {
      layers[layer] = !layers[layer];
      target.textContent = `${QA_SKIN_LAYER_LABELS[layer]} ${layers[layer] ? 'on' : 'off'}`;
      applyAppearance();
    }
    if (target.dataset.toggle === 'hurt') {
      hurt = !hurt;
      target.textContent = `hurt ${hurt ? 'on' : 'off'}`;
    }
    if (target.dataset.toggle === 'invisible') {
      invisible = !invisible;
      target.textContent = `invis ${invisible ? 'on' : 'off'}`;
    }
  };
  root.addEventListener('click', onClick);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'F5' || event.repeat) return;
    event.preventDefault();
    perspective = nextCameraPerspective(perspective);
  };
  addEventListener('keydown', onKeyDown);

  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    firstPerson.resize(width, height);
  };
  resize();
  addEventListener('resize', resize);

  const firstPersonState: FirstPersonFrameState = {
    visible: false, movementSpeed: 0, onGround: true, sprinting: false,
    mining: false, foodUseProgress: 0, bowCharge: 0,
  };
  const playerState: PlayerVisualFrameState = {
    viewYaw: 0, viewPitch: 0, movementSpeed: 0, onGround: true, sneaking: false,
    sprinting: false, verticalVelocity: 0, mining: false, bowCharge: 0,
    swordBlocking: false, foodUseProgress: 0, invisible: false, hurtFlash: 0,
  };
  let frame = 0;
  let previous = performance.now();
  let elapsed = 0;
  const render = (now: number): void => {
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    elapsed += delta;
    const moving = pose === 'walk' || pose === 'sprint';
    const jumping = pose === 'jump';
    const bow = pose === 'bow';
    const eating = pose === 'eat';
    Object.assign(playerState, {
      viewYaw,
      viewPitch,
      movementSpeed: moving ? (pose === 'sprint' ? 5.4 : 3.1) : 0,
      onGround: !jumping,
      sneaking: pose === 'sneak',
      sprinting: pose === 'sprint',
      verticalVelocity: jumping ? Math.sin(elapsed * 3) * 5 : 0,
      mining: pose === 'mining',
      bowCharge: bow ? (elapsed % 2) / 2 : 0,
      swordBlocking: pose === 'block',
      foodUseProgress: eating ? (elapsed % 2) / 2 : 0,
      invisible,
      hurtFlash: hurt ? (0.35 + Math.sin(elapsed * 8) * 0.25) : 0,
    });
    if (pose === 'attack' && now - lastAttack > 700) {
      player.swing();
      firstPerson.swing();
      lastAttack = now;
    }
    player.update(delta, playerState);
    setEntityLight(player.root, hurt ? [1.2, 0.48, 0.48] : [1, 1, 1]);
    player.setVisible(perspective !== 'firstPerson');

    firstPersonState.visible = perspective === 'firstPerson';
    firstPersonState.movementSpeed = playerState.movementSpeed;
    firstPersonState.onGround = playerState.onGround;
    firstPersonState.sprinting = playerState.sprinting;
    firstPersonState.mining = playerState.mining;
    firstPersonState.foodUseProgress = playerState.foodUseProgress;
    firstPersonState.bowCharge = playerState.bowCharge;
    firstPersonState.swordBlocking = playerState.swordBlocking;
    firstPersonState.invisible = playerState.invisible;
    firstPerson.update(delta, firstPersonState);

    if (perspective === 'thirdPersonBack') camera.position.set(0, 1.55, 4.2);
    else camera.position.set(0, 1.55, -4.2);
    camera.lookAt(0, 1.05, 0);
    renderer.info.reset();
    renderer.render(scene, camera);
    firstPerson.render(renderer);
    const enabledLayers = Object.entries(layers).filter(([, enabled]) => enabled).map(([layer]) => layer).join(', ');
    output.textContent = `${appearance.skinId} · ${appearance.model} · layers ${enabledLayers || 'none'}\n${pose} · ${perspective} · held ${heldItem || 'empty'}\narmor ${equipment.head ?? '-'} | ${equipment.chest ?? '-'} | ${equipment.legs ?? '-'} | ${equipment.feet ?? '-'}\ncache skins ${skins.cacheSize} refs ${skins.referenceCount(appearance.skinId)} · geometry ${geometries.size} · armor ${armorGeometries.size}/${armorMaterials.textureCount}\ndraw ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles}`;
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    removeEventListener('keydown', onKeyDown);
    root.removeEventListener('click', onClick);
    player.dispose();
    firstPerson.dispose();
    geometries.dispose();
    armorGeometries.dispose();
    armorMaterials.dispose();
    skins.dispose();
    items.dispose();
    atlas.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    renderer.dispose();
  };
}
