import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EmoteSession } from '../src/gameplay/emoteSession';
import { PlayerVisualAnimator } from '../src/rendering/player/PlayerVisualAnimator';
import { createEmotePose, emotePoseAtRest, writeEmotePose } from '../src/rendering/player/emotePose';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerArmorGeometryCache, PlayerArmorMaterialCache } from '../src/rendering/player/PlayerArmorVisual';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual, type PlayerVisualFrameState } from '../src/rendering/player/PlayerVisual';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import {
  EMOTE_IDS,
  EMOTE_LABELS,
  emoteDurationTicks,
  emoteMovementInterrupts,
  emoteSectorFromPointer,
} from '../shared/emotes';
import { parseClientMessage } from '../shared/protocol';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const gameUi = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');
const menuGui = readFileSync(new URL('../src/ui/gameMenuGui.ts', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('../src/input/InputManager.ts', import.meta.url), 'utf8');

const idle = {
  viewYaw: 0,
  viewPitch: 0,
  movementSpeed: 0,
  onGround: true,
  sneaking: false,
  sprinting: false,
  verticalVelocity: 0,
  mining: false,
  bowCharge: 0,
  swordBlocking: false,
  foodUseProgress: 0,
};

const frame: PlayerVisualFrameState = { ...idle, invisible: false, hurtFlash: 0 };
const still = { forward: 0, right: 0, jump: false, sneak: false, descend: false };

describe('emote wheel selection', () => {
  it('maps the four cardinal sectors and keeps the center empty', () => {
    const radius = 100;
    expect(emoteSectorFromPointer(0, -80, radius)).toBe('wave');
    expect(emoteSectorFromPointer(80, 0, radius)).toBe('celebrate');
    expect(emoteSectorFromPointer(0, 80, radius)).toBe('point');
    expect(emoteSectorFromPointer(-80, 0, radius)).toBe('bow');
    expect(emoteSectorFromPointer(10, -8, radius)).toBeNull();
    expect(emoteSectorFromPointer(0, 0, radius)).toBeNull();
    expect(EMOTE_IDS.map((id) => EMOTE_LABELS[id])).toEqual([
      'Приветствие',
      'Празднование',
      'Указывание',
      'Поклон',
    ]);
  });

  it('starts the aimed emote on release and closes on the dead zone', () => {
    const session = new EmoteSession();
    expect(session.tryOpen(true)).toBe(true);
    expect(session.tryOpen(true)).toBe(false);
    expect(session.point(0, -80, 100)).toBe('wave');
    expect(session.release()).toBe('wave');
    expect(session.forcesThirdPerson).toBe(true);
    expect(session.blocksPrimaryHand).toBe(true);
    expect(session.blocksMovement).toBe(false);
    expect(session.tryOpen(true)).toBe(false);

    const empty = new EmoteSession();
    empty.tryOpen(true);
    empty.point(4, 4, 100);
    expect(empty.release()).toBeNull();
    expect(empty.phaseName).toBe('idle');
    expect(empty.forcesThirdPerson).toBe(false);
  });

  it('refuses to open outside ordinary play and ignores a second hold', () => {
    const session = new EmoteSession();
    expect(session.tryOpen(false)).toBe(false);
    expect(session.phaseName).toBe('idle');
  });
});

describe('emote playback', () => {
  it('interrupts on movement intent and not on a still player', () => {
    expect(emoteMovementInterrupts(still)).toBe(false);
    expect(emoteMovementInterrupts({ ...still, forward: 0.05, right: -0.05 })).toBe(false);
    expect(emoteMovementInterrupts({ ...still, forward: 1 })).toBe(true);
    expect(emoteMovementInterrupts({ ...still, right: -1 })).toBe(true);
    expect(emoteMovementInterrupts({ ...still, jump: true })).toBe(true);
    expect(emoteMovementInterrupts({ ...still, sneak: true })).toBe(true);
    expect(emoteMovementInterrupts({ ...still, descend: true })).toBe(true);

    const session = new EmoteSession();
    session.tryOpen(true);
    session.point(80, 0, 100);
    expect(session.release()).toBe('celebrate');
    expect(session.advance(0.05, still)).toBe('playing');
    expect(session.advance(0.05, { ...still, jump: true })).toBe('interrupted');
    expect(session.phaseName).toBe('idle');
    expect(session.playing).toBeNull();
  });

  it('plays once and returns to idle when the duration elapses', () => {
    const session = new EmoteSession();
    session.tryOpen(true);
    session.point(0, 80, 100);
    expect(session.release()).toBe('point');
    expect(session.advance(0.05, still)).toBe('playing');
    let status: ReturnType<EmoteSession['advance']> = 'playing';
    for (let step = 0; step < 40 && status === 'playing'; step += 1) status = session.advance(0.05, still);
    expect(status).toBe('finished');
    expect(session.elapsed).toBe(0);
    expect(session.tryOpen(true)).toBe(true);
  });

  it('returns every pose to rest at the ends and holds a readable mid pose', () => {
    for (const id of EMOTE_IDS) {
      expect(emotePoseAtRest(id, 0)).toBe(true);
      expect(emotePoseAtRest(id, 0)).toBe(true);
      const end = writeEmotePose(id, emoteDurationTicks(id) / 20, createEmotePose());
      expect(end.rightArmX).toBe(0);
      expect(end.leftArmX).toBe(0);
      expect(end.bodyPitch).toBe(0);
      expect(end.bodyYOffset).toBe(0);
    }
    const wave = writeEmotePose('wave', 0.7, createEmotePose());
    expect(wave.rightArmX).toBeGreaterThan(2);
    expect(Math.abs(wave.rightArmZ)).toBeGreaterThan(0.05);
    const celebrate = writeEmotePose('celebrate', 0.6, createEmotePose());
    expect(celebrate.rightArmX).toBeGreaterThan(2);
    expect(celebrate.leftArmX).toBeGreaterThan(2);
    expect(celebrate.rightArmZ).toBeLessThan(0);
    expect(celebrate.leftArmZ).toBeGreaterThan(0);
    const point = writeEmotePose('point', 0.7, createEmotePose());
    expect(point.rightArmX).toBeGreaterThan(1.2);
    expect(point.rightArmX).toBeLessThan(1.8);
    const bow = writeEmotePose('bow', 0.7, createEmotePose());
    expect(bow.bodyPitch).toBeLessThan(-0.5);
    expect(bow.rightArmX).toBeLessThan(0);
    expect(bow.leftArmX).toBeLessThan(0);
  });

  it('overrides the walk pose only while an emote is active', () => {
    const animator = new PlayerVisualAnimator();
    const walking = animator.advance(1 / 60, { ...idle, movementSpeed: 4 });
    const emoting = animator.advance(1 / 60, { ...idle, emote: 'wave', emoteTime: 0.7 });
    expect(emoting.rightArmX).toBeGreaterThan(2);
    expect(Math.abs(walking.rightArmX)).toBeLessThan(1);
    const restored = animator.advance(1 / 60, idle);
    expect(Math.abs(restored.rightArmX)).toBeLessThan(0.5);
  });
});

describe('emote presentation on the player model', () => {
  it('hides the held item for the emote and keeps armor parented to the body', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const materials = new PlayerArmorMaterialCache();
    const armorGeometries = new PlayerArmorGeometryCache();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE, {
      armorResources: { materials, geometries: armorGeometries },
    });
    visual.setHeldItem('diamond_sword');
    visual.setArmor({ head: null, chest: 'iron_chestplate', legs: null, feet: 'iron_boots' });
    visual.update(1 / 60, frame);
    expect(visual.rig.heldItem.visible).toBe(true);
    const chest = visual.armor.meshes('chest')[0]?.base;
    const feet = visual.armor.meshes('feet')[0]?.base;
    expect(chest?.visible).toBe(true);
    expect(feet?.visible).toBe(true);
    const chestParent = chest?.parent;
    visual.update(1 / 60, { ...frame, emote: 'bow', emoteTime: 0.7 });
    expect(visual.rig.heldItem.visible).toBe(false);
    expect(chest?.visible).toBe(true);
    expect(feet?.visible).toBe(true);
    expect(chest?.parent).toBe(chestParent);
    expect(visual.rig.upperBody.rotation.x).toBeLessThan(-0.4);
    visual.update(1 / 60, frame);
    expect(visual.rig.heldItem.visible).toBe(true);
    expect(chest?.visible).toBe(true);
    expect(chest?.parent).toBe(chestParent);
    visual.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
    materials.dispose();
    armorGeometries.dispose();
  });
});

describe('emote protocol and HUD hint', () => {
  it('parses a start and a stop and rejects an unknown id', () => {
    expect(parseClientMessage({ type: 'emote', action: 'start', id: 'wave' })).toEqual({
      type: 'emote', action: 'start', id: 'wave',
    });
    expect(parseClientMessage({ type: 'emote', action: 'stop', id: 'nope' })).toEqual({
      type: 'emote', action: 'stop',
    });
    expect(parseClientMessage({ type: 'emote', action: 'start', id: 'dance' })).toEqual({
      error: 'emote.id invalid',
    });
    expect(parseClientMessage({ type: 'emote', action: 'hold' })).toEqual({
      error: 'emote.action invalid',
    });
  });

  it('places the supplied Z hint under the corner buttons without taking pointer events', () => {
    expect(gameUi.indexOf('id="hud-menu"')).toBeLessThan(gameUi.indexOf('id="hud-emote"'));
    expect(gameUi).toContain('hud-corner-key">Z');
    expect(gameUi).toContain('EMOTE_LABELS[id]');
    expect(menuGui).toContain("'emote_z.png'");
    expect(css).toContain('#hud-emote');
    expect(css).toContain('background-image: var(--hud-emote-img);');
    expect(css).toContain('background-size: contain;');
    expect(css).toMatch(/#hud-emote \{[^}]*pointer-events: none;/s);
    expect(css).toMatch(/#hud-emote \{[^}]*aspect-ratio: 1;/s);
    expect(inputSource).toContain("event.code === 'KeyZ'");
    expect(css).toContain('#emote-wheel');
    expect(gameUi).toContain('id="emote-wheel"');
  });
});
