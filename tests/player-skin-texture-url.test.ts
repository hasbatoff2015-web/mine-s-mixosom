import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextureAtlas } from '../src/rendering/TextureAtlas';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { BUILTIN_MINECRAFT_SKINS, QA_PLAYER_SKIN_ID, skinDescriptor } from '../src/player/appearance/builtinSkins';
import { BUYER_NPC_SKIN_ID } from '../shared/buyers';
import { createPlayerAppearance } from '../src/player/appearance/PlayerAppearance';
import playerSkinContentHashes from 'virtual:player-skin-content-hashes';
import minecraftSkinSource from '../src/rendering/player/MinecraftSkin.ts?raw';
import gameUiSource from '../src/ui/GameUI.ts?raw';
import buyerNpcSource from '../src/net/BuyerNpcView.ts?raw';
import gameSource from '../src/core/Game.ts?raw';

/** Retired green-black merchant PNG shipped in `08cd21b`. */
const RETIRED_BUYER_MERCHANT_SHA256 =
  '81a1c375498a9a33ad0f43cf8a1e7626d70b94f391058c64cfc9dad23e197f65';

function pngSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function playerSkinHashQuery(texturePath: string): string {
  const digest = pngSha256(resolve('public', 'textures', `${texturePath}.png`)).slice(0, 16);
  return `?v=${digest}`;
}

describe('player skin texture URLs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not ship the retired green-black buyer_merchant PNG', () => {
    const path = resolve('public/textures/player/skins/buyer_merchant.png');
    expect(pngSha256(path)).not.toBe(RETIRED_BUYER_MERCHANT_SHA256);
  });

  it('exposes the current public PNG hash through the Vite virtual module', () => {
    const expected = pngSha256(resolve('public/textures/player/skins/buyer_merchant.png')).slice(0, 16);
    expect(playerSkinContentHashes['player/skins/buyer_merchant']).toBe(expected);
  });

  it('cache-busts player/skins URLs with the current public PNG hash', () => {
    const buyerPath = 'player/skins/buyer_merchant';
    const expectedBuyer = `${import.meta.env.BASE_URL}textures/${buyerPath}.png${playerSkinHashQuery(buyerPath)}`;
    expect(BUYER_NPC_SKIN_ID).toBe('buyer_merchant');
    expect(TextureAtlas.url(buyerPath)).toBe(expectedBuyer);
    expect(TextureAtlas.url(buyerPath)).toMatch(/textures\/player\/skins\/buyer_merchant\.png\?v=[0-9a-f]{16}$/);

    const explorerPath = 'player/skins/frontier_explorer';
    expect(TextureAtlas.url(explorerPath)).toBe(
      `${import.meta.env.BASE_URL}textures/${explorerPath}.png${playerSkinHashQuery(explorerPath)}`,
    );

    expect(TextureAtlas.url('block/stone')).toBe(`${import.meta.env.BASE_URL}textures/block/stone.png`);
    expect(TextureAtlas.url('item/book')).not.toContain('?v=');
  });

  it('covers every public player/skins PNG with a matching content-hash query', () => {
    const qa = BUILTIN_MINECRAFT_SKINS.find((skin) => skin.id === QA_PLAYER_SKIN_ID);
    expect(qa?.texturePath).toBe('entity/player_uv_test');
    expect(TextureAtlas.url(qa!.texturePath)).toBe(
      `${import.meta.env.BASE_URL}textures/entity/player_uv_test.png`,
    );

    const hashed = BUILTIN_MINECRAFT_SKINS.filter((skin) => skin.texturePath.startsWith('player/skins/'));
    expect(hashed.length).toBe(BUILTIN_MINECRAFT_SKINS.length - 1);
    for (const skin of hashed) {
      expect(TextureAtlas.url(skin.texturePath)).toBe(
        `${import.meta.env.BASE_URL}textures/${skin.texturePath}.png${playerSkinHashQuery(skin.texturePath)}`,
      );
    }
  });

  it('loads registry skins and selector thumbs through TextureAtlas.url', () => {
    expect(minecraftSkinSource).toContain('TextureAtlas.url(descriptor.texturePath)');
    expect(gameUiSource).toContain('TextureAtlas.url(`player/skins/${skinId}`)');
  });

  it('keeps createPlayerAppearance(buyer_merchant) off the frontier_explorer fallback', () => {
    expect(skinDescriptor(BUYER_NPC_SKIN_ID)?.id).toBe('buyer_merchant');
    expect(createPlayerAppearance({ skinId: BUYER_NPC_SKIN_ID, model: 'classic' }).skinId).toBe('buyer_merchant');
    expect(buyerNpcSource).toContain('skinId: BUYER_NPC_SKIN_ID');
    expect(gameSource).toContain("skinId: 'buyer_merchant'");
  });

  it('acquire(buyer_merchant) loads the hashed merchant URL, not frontier_explorer', () => {
    const loads: string[] = [];
    vi.stubGlobal('document', { createElement() { return {}; } });
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(function (
      this: THREE.TextureLoader,
      url: string,
    ) {
      loads.push(url);
      return new THREE.Texture();
    });

    const registry = new MinecraftSkinRegistry();
    const handle = registry.acquire(BUYER_NPC_SKIN_ID);
    expect(handle.skinId).toBe('buyer_merchant');
    expect(handle.skinId).not.toBe('frontier_explorer');
    expect(loads).toEqual([TextureAtlas.url('player/skins/buyer_merchant')]);
    expect(loads[0]).toMatch(/textures\/player\/skins\/buyer_merchant\.png\?v=[0-9a-f]{16}$/);
    expect(loads[0]).not.toContain('frontier_explorer');
    handle.release();
    registry.dispose();
  });

  it('falls back to frontier_explorer only for an unregistered id', () => {
    const registry = new MinecraftSkinRegistry();
    const missing = registry.acquire('not_a_registered_skin');
    expect(missing.skinId).toBe('frontier_explorer');
    const buyer = registry.acquire(BUYER_NPC_SKIN_ID);
    expect(buyer.skinId).toBe('buyer_merchant');
    missing.release();
    buyer.release();
    registry.dispose();
  });
});
