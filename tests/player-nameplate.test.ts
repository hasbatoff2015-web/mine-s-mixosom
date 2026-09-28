import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot, RemotePlayerInfo } from '../shared/protocol';
import { IDLE_PLAYER_PRESENTATION } from '../shared/playerPresentation';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import { REMOTE_TICK_MS } from '../src/net/remotePlayerInterpolation';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import {
  NAMEPLATE_FONT,
  NAMEPLATE_HEALTH_COLOR,
  NAMEPLATE_HEALTH_FONT_PX,
  NAMEPLATE_HEIGHT,
  NAMEPLATE_HEIGHT_OFFSET,
  NAMEPLATE_MAX_DISTANCE,
  NAMEPLATE_NAME_COLOR,
  NAMEPLATE_NAME_FONT_PX,
  NAMEPLATE_SIZE_SCALE,
  NAMEPLATE_TEXT_LOGICAL_HEIGHT,
  NAMEPLATE_TEXT_LOGICAL_WIDTH,
  NAMEPLATE_TEXT_PAD_X,
  NAMEPLATE_WIDTH,
  PlayerNameplate,
  nameplateLines,
  nameplateOpacity,
  nameplateTextLayout,
} from '../src/rendering/player/PlayerNameplate';
import { VoxelWorld } from '../src/world/World';
import gameSource from '../src/core/Game.ts?raw';
import nameplateSource from '../src/rendering/player/PlayerNameplate.ts?raw';
import { hologramCanvasFont, hologramTextCanvasScale } from '../shared/hologramStyle';
import { hologramDevicePixelRatio } from '../src/rendering/hologramTextCanvas';
import {
  PLAYER_CHAT_BUBBLE_GAP,
  playerChatBubbleLayout,
  playerChatBubbleNicknameVisualTop,
} from '../src/rendering/player/playerChatBubbleLayout';

const remoteInfo: RemotePlayerInfo = {
  id: 'remote', name: 'Misha', x: 0, y: 70, z: 0, yaw: 0, pitch: 0, health: 20,
  appearance: DEFAULT_PLAYER_APPEARANCE,
};

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'remote', name: 'Misha', x: 2, y: 70, z: 0,
    yaw: 0.6, pitch: 0.25, vx: 3, vy: 0, vz: 1,
    health: 20, gamemode: 'survival', sneaking: false, sprinting: false,
    onGround: true, selectedSlot: 3, invisible: false,
    ...overrides,
  };
}

function makeView(info: RemotePlayerInfo = remoteInfo): {
  view: RemotePlayerView;
  visual: PlayerVisual;
  dispose(): void;
} {
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const visual = new PlayerVisual(skins, geometries, items, info.appearance ?? DEFAULT_PLAYER_APPEARANCE);
  const world = new VoxelWorld('nameplate');
  const view = new RemotePlayerView(info, { visual, world }, 0);
  return {
    view,
    visual,
    dispose() {
      view.dispose();
      geometries.dispose();
      items.dispose();
      skins.dispose();
    },
  };
}

describe('player nameplate', () => {
  it('keeps one WH rim per base body part across Classic and Slim rebuilds', () => {
    const { view, visual, dispose } = makeView();
    const outlines = () => {
      const lines: THREE.LineSegments[] = [];
      visual.root.traverse((part) => { if (part instanceof THREE.LineSegments) lines.push(part); });
      return lines;
    };
    view.setWhMarked(true);
    const classic = outlines();
    expect(classic).toHaveLength(6);
    expect(classic.every((line) => line.visible)).toBe(true);
    view.setAppearance(createPlayerAppearance({ ...DEFAULT_PLAYER_APPEARANCE, model: 'slim' }));
    const slim = outlines();
    expect(slim).toHaveLength(6);
    expect(slim.every((line) => line.visible && line.parent !== null)).toBe(true);
    expect(classic.every((line) => line.parent === null)).toBe(true);
    view.setWhMarked(false);
    expect(outlines().every((line) => !line.visible)).toBe(true);
    dispose();
  });
  it('shows nickname and health on two lines', () => {
    expect(nameplateLines('Misha', 20)).toEqual(['Misha', '❤ 20']);
    const plate = new PlayerNameplate('Misha', 20);
    expect(plate.lines).toEqual(['Misha', '❤ 20']);
    expect(plate.setIdentity('Misha', 18)).toBe(true);
    expect(plate.lines).toEqual(['Misha', '❤ 18']);
    expect(plate.setIdentity('Misha', 18)).toBe(false);
    plate.dispose();
  });

  it('updates health text from authoritative snapshots and heals', () => {
    const { view, dispose } = makeView();
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 20']);
    view.applySnapshot(snapshot({ health: 18 }), 10 * REMOTE_TICK_MS, 10);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 18']);
    view.applySnapshot(snapshot({ health: 14 }), 11 * REMOTE_TICK_MS, 11);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 14']);
    view.applySnapshot(snapshot({ health: 20 }), 12 * REMOTE_TICK_MS, 12);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 20']);
    view.applySnapshot(snapshot({ health: 0, dead: true }), 13 * REMOTE_TICK_MS, 13);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 0']);
    dispose();
  });

  it('follows interpolated remote feet instead of the raw snapshot pose', () => {
    const { view, dispose } = makeView();
    for (let tick = 10; tick <= 16; tick += 1) {
      view.applySnapshot(snapshot({
        x: (tick - 10) * 0.2,
        y: 70,
        presentation: IDLE_PLAYER_PRESENTATION,
      }), tick * REMOTE_TICK_MS, tick);
    }
    const pose = view.interpolate(16 * REMOTE_TICK_MS, 1 / 60, 0.7);
    expect(pose).toBeDefined();
    expect(view.group.position.x).toBeCloseTo(pose!.x);
    expect(view.nameplate.sprite.parent).toBe(view.group);
    const world = new THREE.Vector3();
    view.nameplate.sprite.getWorldPosition(world);
    expect(world.x).toBeCloseTo(view.group.position.x);
    expect(world.y).toBeCloseTo(view.group.position.y + NAMEPLATE_HEIGHT_OFFSET);
    dispose();
  });

  it('billboards with Sprite and hides with invisibility plus distance', () => {
    const { view, dispose } = makeView();
    expect(view.nameplate.sprite).toBeInstanceOf(THREE.Sprite);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 71, 2);
    view.interpolate(0, 0, 1);
    view.updateNameplate(camera);
    expect(view.nameplate.sprite.visible).toBe(true);
    camera.position.set(0, 71, NAMEPLATE_MAX_DISTANCE + 8);
    view.updateNameplate(camera);
    expect(view.nameplate.sprite.visible).toBe(false);
    expect(nameplateOpacity(NAMEPLATE_MAX_DISTANCE)).toBe(0);
    expect(nameplateOpacity(0)).toBe(1);

    for (let tick = 20; tick <= 24; tick += 1) {
      view.applySnapshot(snapshot({ invisible: true, x: 0, y: 70, z: 0 }), tick * REMOTE_TICK_MS, tick);
    }
    camera.position.set(0, 71, 2);
    view.interpolate(24 * REMOTE_TICK_MS, 1 / 60, 1);
    view.updateNameplate(camera);
    expect(view.nameplate.sprite.visible).toBe(false);
    dispose();
  });

  it('applies remote appearance metadata to PlayerVisual without a second model pipeline', () => {
    const slim = createPlayerAppearance({ skinId: 'e3eb6f99ea1c3fe1', model: 'slim' });
    const { view, visual, dispose } = makeView({ ...remoteInfo, appearance: slim });
    expect(visual.appearance.skinId).toBe(slim.skinId);
    view.setAppearance(DEFAULT_PLAYER_APPEARANCE);
    expect(visual.appearance).toEqual(DEFAULT_PLAYER_APPEARANCE);
    dispose();
  });

  it('does not attach a local first-person nameplate in Game', () => {
    expect(gameSource).toContain('remote.updateNameplate(this.camera, now)');
    expect(gameSource).not.toContain('new PlayerNameplate(');
    expect(gameSource).toContain('session.playerVisual.setVisible(');
  });

  it('draws nick and HP without a background panel, using hologram pixel font and 2× world size', () => {
    expect(NAMEPLATE_SIZE_SCALE).toBe(2);
    expect(NAMEPLATE_WIDTH).toBeCloseTo(2.1);
    expect(NAMEPLATE_HEIGHT).toBeCloseTo(0.84);
    expect(NAMEPLATE_HEIGHT_OFFSET).toBe(2.05);
    expect(NAMEPLATE_FONT).toBe('display');
    expect(NAMEPLATE_NAME_COLOR).toBe('#fff7c2');
    expect(NAMEPLATE_HEALTH_COLOR).toBe('#ff1f1f');
    expect(NAMEPLATE_NAME_FONT_PX).toBe(44);
    expect(NAMEPLATE_HEALTH_FONT_PX).toBe(36);
    expect(hologramCanvasFont(NAMEPLATE_FONT, 'bold', NAMEPLATE_NAME_FONT_PX)).toContain('"Press Start 2P"');
    expect(nameplateSource).not.toMatch(/fillRect/);
    expect(nameplateSource).not.toMatch(/NearestFilter/);
    expect(nameplateSource).not.toMatch(/rgba\(0,\s*0,\s*0/);
    expect(nameplateSource).toContain('hologramCanvasFont');
    expect(nameplateSource).toContain('configureHologramTextTexture');
    expect(nameplateSource).toContain('createHologramTextCanvas');
    expect(nameplateSource).toContain('ensureHologramTextCanvasResolution');
    expect(nameplateSource).toContain('hologramTextCanvasScale');
    expect(nameplateSource).toContain('setTransform');
    expect(nameplateSource).toContain('texture.needsUpdate = true');
    expect(nameplateSource).not.toContain('HologramRenderer');
    expect(nameplateSource).not.toMatch(/slice\(0,\s*16\)/);
    expect(nameplateSource).toContain('measureText');

    const plate = new PlayerNameplate('Misha', 20);
    expect(plate.sprite.scale.x).toBeCloseTo(NAMEPLATE_WIDTH);
    expect(plate.sprite.scale.y).toBeCloseTo(NAMEPLATE_HEIGHT);
    const material = plate.sprite.material as THREE.SpriteMaterial;
    expect(material.map?.magFilter).toBe(THREE.LinearFilter);
    expect(material.map?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(material.map?.generateMipmaps).toBe(true);
    const canvas = material.map?.image as HTMLCanvasElement | undefined;
    if (canvas && canvas.width > 0) {
      const scale = hologramTextCanvasScale(hologramDevicePixelRatio());
      expect(canvas.width).toBe(NAMEPLATE_TEXT_LOGICAL_WIDTH * scale);
      expect(canvas.height).toBe(NAMEPLATE_TEXT_LOGICAL_HEIGHT * scale);
      expect(canvas.width).toBeGreaterThan(256);
      expect(canvas.height).toBeGreaterThan(96);
    }
    plate.dispose();
  });

  it('fits a max-length nick inside the logical atlas with side padding', () => {
    const longNick = '1234567890123';
    expect(longNick).toHaveLength(13);
    const layout = nameplateTextLayout(longNick, 20);
    expect(layout.logicalWidth).toBeGreaterThan(NAMEPLATE_TEXT_LOGICAL_WIDTH);
    expect(layout.nameLeft).toBeGreaterThanOrEqual(NAMEPLATE_TEXT_PAD_X);
    expect(layout.paddingLeft).toBeGreaterThanOrEqual(NAMEPLATE_TEXT_PAD_X);
    expect(layout.paddingRight).toBeGreaterThanOrEqual(NAMEPLATE_TEXT_PAD_X);
    expect(layout.nameRight + NAMEPLATE_TEXT_PAD_X).toBeLessThanOrEqual(layout.logicalWidth + 1e-9);
    expect(layout.nameRight).toBeLessThanOrEqual(layout.logicalWidth);
    expect(layout.worldHeight).toBeCloseTo(NAMEPLATE_HEIGHT);
    expect(layout.worldWidth).toBeGreaterThan(NAMEPLATE_WIDTH);

    const short = nameplateTextLayout('Misha', 20);
    expect(short.logicalWidth).toBe(NAMEPLATE_TEXT_LOGICAL_WIDTH);
    expect(short.worldWidth).toBeCloseTo(NAMEPLATE_WIDTH);
    expect(short.paddingLeft).toBeGreaterThanOrEqual(NAMEPLATE_TEXT_PAD_X);

    const plate = new PlayerNameplate(longNick, 20);
    expect(plate.logicalCanvasWidth).toBe(layout.logicalWidth);
    expect(plate.sprite.scale.x).toBeCloseTo(layout.worldWidth);
    expect(plate.sprite.scale.y).toBeCloseTo(NAMEPLATE_HEIGHT);
    const material = plate.sprite.material as THREE.SpriteMaterial;
    const canvas = material.map?.image as HTMLCanvasElement | undefined;
    if (canvas && canvas.width > 0) {
      const scale = hologramTextCanvasScale(hologramDevicePixelRatio());
      expect(canvas.width).toBe(layout.logicalWidth * scale);
      expect(canvas.height).toBe(NAMEPLATE_TEXT_LOGICAL_HEIGHT * scale);
    }
    plate.dispose();
  });
});

describe('remote player chat bubble', () => {
  it('sits above the nameplate, follows the player, and replaces instead of stacking', () => {
    const { view, dispose } = makeView();
    expect(view.chatBubble.sprite).toBeInstanceOf(THREE.Sprite);
    expect(view.group.children).toContain(view.chatBubble.sprite);
    expect(view.group.children).toContain(view.nameplate.sprite);

    view.showChatBubble('привет', 1_000);
    const short = playerChatBubbleLayout(view.chatBubble.lines);
    expect(view.chatBubble.lines).toEqual(['привет']);
    expect(view.chatBubble.sprite.position.y).toBeCloseTo(short.centerY);
    expect(short.centerY - short.worldHeight / 2).toBeCloseTo(
      playerChatBubbleNicknameVisualTop() + PLAYER_CHAT_BUBBLE_GAP,
    );

    view.showChatBubble(`${'длинное слово '.repeat(8)}конец`, 4_000);
    const tall = playerChatBubbleLayout(view.chatBubble.lines);
    expect(view.chatBubble.lines.length).toBeGreaterThan(1);
    expect(view.chatBubble.sprite.position.y).toBeCloseTo(tall.centerY);
    expect(tall.centerY - tall.worldHeight / 2).toBeCloseTo(
      playerChatBubbleNicknameVisualTop() + PLAYER_CHAT_BUBBLE_GAP,
    );
    expect(tall.centerY).toBeGreaterThan(short.centerY);
    expect(view.chatBubble.sprite.position.y - tall.worldHeight / 2).toBeGreaterThan(
      playerChatBubbleNicknameVisualTop() - 1e-6,
    );
    expect(view.group.children.filter((child) => child.name === 'player-chat-bubble')).toHaveLength(1);

    view.group.position.set(4, 8, -2);
    const world = new THREE.Vector3();
    view.chatBubble.sprite.getWorldPosition(world);
    expect(world.x).toBeCloseTo(4);
    expect(world.z).toBeCloseTo(-2);
    expect(world.y).toBeCloseTo(8 + view.chatBubble.sprite.position.y);
    dispose();
  });

  it('hides with invisibility and the nameplate distance fade, and clears on reset', () => {
    const { view, dispose } = makeView();
    const camera = new THREE.PerspectiveCamera();
    view.group.position.set(0, 0, 0);
    view.showChatBubble('hello', 0);
    const bubbleY = view.chatBubble.sprite.position.y;
    camera.position.set(0, bubbleY, 10);
    view.updateNameplate(camera, 100);
    expect(view.chatBubble.sprite.visible).toBe(true);
    expect((view.chatBubble.sprite.material as THREE.SpriteMaterial).opacity).toBeCloseTo(nameplateOpacity(10));

    camera.position.set(0, bubbleY, 40);
    view.updateNameplate(camera, 100);
    expect((view.chatBubble.sprite.material as THREE.SpriteMaterial).opacity).toBeCloseTo(nameplateOpacity(40));

    camera.position.set(0, bubbleY, NAMEPLATE_MAX_DISTANCE + 8);
    view.updateNameplate(camera, 100);
    expect(view.chatBubble.sprite.visible).toBe(false);

    view.group.position.set(0, 70, 0);
    for (let tick = 20; tick <= 24; tick += 1) {
      view.applySnapshot(snapshot({ invisible: true, x: 0, y: 70, z: 0 }), tick * REMOTE_TICK_MS, tick);
    }
    camera.position.set(0, 72, 2);
    view.interpolate(24 * REMOTE_TICK_MS, 1 / 60, 1);
    view.showChatBubble('secret', 24 * REMOTE_TICK_MS);
    view.updateNameplate(camera, 24 * REMOTE_TICK_MS);
    expect(view.nameplate.sprite.visible).toBe(false);
    expect(view.chatBubble.sprite.visible).toBe(false);

    view.reset(remoteInfo, 30_000);
    view.group.position.set(0, 0, 0);
    camera.position.set(0, 2, 4);
    view.updateNameplate(camera, 30_000);
    expect(view.chatBubble.visibleAt(30_000)).toBe(false);
    expect(view.chatBubble.sprite.visible).toBe(false);
    expect(view.chatBubble.text).toBe('');
    dispose();
  });

  it('repaints only when the text changes and disposes the bubble with the view', () => {
    const { view, dispose } = makeView();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 72, 3);
    view.showChatBubble('one', 0);
    const paints = view.chatBubble.paints;
    expect(paints).toBeGreaterThan(0);
    for (let frame = 1; frame <= 8; frame += 1) view.updateNameplate(camera, frame * 100);
    expect(view.chatBubble.paints).toBe(paints);
    view.showChatBubble('two', 1_000);
    expect(view.chatBubble.paints).toBe(paints + 1);
    const sprite = view.chatBubble.sprite;
    dispose();
    expect(sprite.parent).toBeNull();
  });
});
