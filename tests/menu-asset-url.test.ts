import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatAssetUrl,
  chatChromeStyle,
  hudChromeStyle,
  menuAssetUrl,
  menuChromeStyle,
  resolveAssetUrl,
} from '../src/ui/gameMenuGui';

const PRODUCTION = 'https://megacraft.agariobrainrot.ru/';
const LOCALHOST = 'http://localhost:5173/';
const NESTED = 'https://example.com/game/';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('resolveAssetUrl', () => {
  it('resolves a HUD sprite against the document, not the /assets stylesheet', () => {
    expect(resolveAssetUrl('./ui/menu/pause.png', PRODUCTION)).toBe(
      'https://megacraft.agariobrainrot.ru/ui/menu/pause.png',
    );
    expect(resolveAssetUrl('./ui/menu/pause.png', PRODUCTION)).not.toBe(
      'https://megacraft.agariobrainrot.ru/assets/ui/menu/pause.png',
    );
    expect(new URL('./ui/menu/pause.png', `${PRODUCTION}assets/index.css`).toString()).toBe(
      'https://megacraft.agariobrainrot.ru/assets/ui/menu/pause.png',
    );
  });

  it('resolves the same relative sprite on localhost', () => {
    expect(resolveAssetUrl('./ui/menu/pause.png', LOCALHOST)).toBe(
      'http://localhost:5173/ui/menu/pause.png',
    );
  });

  it('keeps a nested document directory from base: ./', () => {
    expect(resolveAssetUrl('./ui/menu/pause.png', NESTED)).toBe(
      'https://example.com/game/ui/menu/pause.png',
    );
    expect(resolveAssetUrl('./ui/menu/pause.png', 'https://example.com/game/index.html')).toBe(
      'https://example.com/game/ui/menu/pause.png',
    );
  });

  it('resolves chat sprites the same way', () => {
    expect(resolveAssetUrl('./ui/chat/tab_global.png', PRODUCTION)).toBe(
      'https://megacraft.agariobrainrot.ru/ui/chat/tab_global.png',
    );
    expect(resolveAssetUrl('./ui/chat/enter.png', LOCALHOST)).toBe(
      'http://localhost:5173/ui/chat/enter.png',
    );
    expect(resolveAssetUrl('./ui/chat/off.png', NESTED)).toBe(
      'https://example.com/game/ui/chat/off.png',
    );
    expect(resolveAssetUrl('./ui/chat/tab_global.png', PRODUCTION)).not.toContain('/assets/ui/chat/');
  });

  it('does not invent a double slash and leaves an absolute URL unchanged', () => {
    expect(resolveAssetUrl('./ui/menu//pause.png', NESTED)).toBe(
      'https://example.com/game/ui/menu/pause.png',
    );
    expect(resolveAssetUrl('./ui/menu/pause.png', 'https://example.com//game/')).toBe(
      'https://example.com/game/ui/menu/pause.png',
    );
    expect(resolveAssetUrl('https://cdn.example/ui/menu/pause.png', PRODUCTION)).toBe(
      'https://cdn.example/ui/menu/pause.png',
    );
    expect(resolveAssetUrl('https://cdn.example/ui/chat/enter.png?v=1', LOCALHOST)).toBe(
      'https://cdn.example/ui/chat/enter.png?v=1',
    );
  });
});

describe('menu and chat chrome URLs', () => {
  it('writes document-absolute CSS urls for HUD, chat, and menu chrome', () => {
    vi.stubEnv('BASE_URL', './');
    vi.stubGlobal('document', { baseURI: PRODUCTION });

    const hud = hudChromeStyle();
    expect(hud).toContain("--hud-pause-img:url('https://megacraft.agariobrainrot.ru/ui/menu/pause.png')");
    expect(hud).toContain("--hud-chat-img:url('https://megacraft.agariobrainrot.ru/ui/menu/chat.png')");
    expect(hud).toContain("--hud-menu-img:url('https://megacraft.agariobrainrot.ru/ui/menu/menu.png')");
    expect(hud).toContain("--hud-pause-hover-img:url('https://megacraft.agariobrainrot.ru/ui/menu/pause_hover.png')");
    expect(hud).not.toContain('/assets/ui/menu/');
    expect(hud).not.toContain("url('./");

    const chat = chatChromeStyle();
    expect(chat).toContain("--chat-tab-global:url('https://megacraft.agariobrainrot.ru/ui/chat/tab_global.png')");
    expect(chat).toContain("--chat-enter-img:url('https://megacraft.agariobrainrot.ru/ui/chat/enter.png')");
    expect(chat).toContain("--chat-off-img:url('https://megacraft.agariobrainrot.ru/ui/chat/off.png')");
    expect(chat).not.toContain('/assets/ui/chat/');

    const menu = menuChromeStyle();
    expect(menu).toContain("--mc-menu-close:url('https://megacraft.agariobrainrot.ru/ui/menu/close.png')");
    expect(menu).toContain("--mc-menu-back:url('https://megacraft.agariobrainrot.ru/ui/menu/back.png')");
    expect(menu).not.toContain('/assets/ui/menu/');

    expect(menuAssetUrl('pause.png')).toBe('https://megacraft.agariobrainrot.ru/ui/menu/pause.png');
    expect(chatAssetUrl('tab_global.png')).toBe('https://megacraft.agariobrainrot.ru/ui/chat/tab_global.png');
  });

  it('keeps a nested base path when Vite base is relative', () => {
    vi.stubEnv('BASE_URL', './');
    vi.stubGlobal('document', { baseURI: NESTED });
    expect(menuAssetUrl('pause.png')).toBe('https://example.com/game/ui/menu/pause.png');
    expect(chatAssetUrl('enter.png')).toBe('https://example.com/game/ui/chat/enter.png');
    expect(hudChromeStyle()).toContain("--hud-pause-img:url('https://example.com/game/ui/menu/pause.png')");
    expect(chatChromeStyle()).toContain("--chat-enter-img:url('https://example.com/game/ui/chat/enter.png')");
  });

  it('resolves dev BASE_URL / against localhost without a double slash', () => {
    vi.stubEnv('BASE_URL', '/');
    vi.stubGlobal('document', { baseURI: LOCALHOST });
    expect(menuAssetUrl('pause.png')).toBe('http://localhost:5173/ui/menu/pause.png');
    expect(chatAssetUrl('tab_global.png')).toBe('http://localhost:5173/ui/chat/tab_global.png');
    expect(menuAssetUrl('pause.png')).not.toContain('//ui/');
  });
});
