import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CROUCH_ICON, INVENTORY_ICON, JUMP_ICON } from '../src/input/touchIcons';

const style = readFileSync('src/style.css', 'utf8');
const icons = readFileSync('src/input/touchIcons.ts', 'utf8');

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface LayoutSnapshot {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly jump: Box;
  readonly crouch: Box;
  readonly inventory: Box;
  readonly hotbar: Box;
  readonly slot: Box;
  readonly offhand: Box;
  readonly corner: Box;
  readonly stick: Box;
  readonly effect: Box;
  readonly playInfo: Box;
  readonly slotVar: string;
}

function chromeBinary(): string {
  const candidates = [
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0] ?? 'google-chrome';
}

function pageHtml(): string {
  const slots = Array.from({ length: 9 }, () => '<div class="slot"></div>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="app">
  <div id="hud">
    <div id="hotbar">${slots}</div>
    <div id="offhand-hud"><div class="slot"></div></div>
    <div id="status-bars"></div>
    <div id="hud-corner">
      <button type="button">Пауза</button>
      <button type="button">Чат</button>
      <button type="button">Меню</button>
    </div>
    <div id="play-info">Игроков: 1
X: 0  Y: 64  Z: 0</div>
    <div id="effect-hud"><div class="effect-chip">Night</div></div>
  </div>
  <div id="touch-joystick"><div class="joystick-ring"><div class="joystick-knob"></div></div></div>
  <div id="touch-actions">
    <button type="button" data-action="jump" aria-label="Прыжок">${JUMP_ICON}</button>
    <button type="button" data-action="sneak" aria-label="Присесть">${CROUCH_ICON}</button>
    <button type="button" data-action="inventory" aria-label="Инвентарь" title="Инвентарь">${INVENTORY_ICON}</button>
  </div>
</div>
</body></html>`;
}

function inventoryHtml(scale: number): string {
  const slots = Array.from({ length: 90 }, () => '<button type="button" class="mc-slot"></button>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root { --touch-target: 44px; } ${style}</style></head><body>
<div id="app">
  <div class="modal-backdrop mc-backdrop">
    <div class="mc-stage" style="--mc-ui-scale:${scale}; --mc-logical-width:195">
      <div class="mc-panel mc-creative">
        <div class="mc-creative-catalog" id="catalog">${slots}</div>
      </div>
      <button type="button" class="mc-close" data-ui="close" aria-label="Закрыть">×</button>
    </div>
  </div>
</div>
<script>document.getElementById('catalog').scrollTop = 48;</script>
</body></html>`;
}

interface InventoryMeasure {
  readonly slot: number;
  readonly zoom: string;
  readonly panelRight: number;
  readonly panelBottom: number;
  readonly closeLeft: number;
  readonly closeRight: number;
  readonly closeTop: number;
  readonly closeBottom: number;
  readonly closeWidth: number;
  readonly catalogTouch: string;
  readonly catalogScroll: number;
  readonly catalogClient: number;
  readonly scrolled: number;
}

async function measureInventory(
  width: number,
  height: number,
  pageUrl: string,
  jobs: Array<{ chrome: ChildProcess; userData: string }>,
): Promise<InventoryMeasure> {
  const launched = await launchChrome(width, height, pageUrl);
  jobs.push(launched);
  const { cdp } = launched;
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
    const probe = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: '!!document.querySelector(".mc-creative-catalog .mc-slot")',
    });
    ready = (probe.result as { value?: boolean } | undefined)?.value === true;
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error(`inventory page did not render at ${width}x${height}`);
  const evaluated = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const slot = document.querySelector('.mc-creative-catalog .mc-slot');
      const panel = document.querySelector('.mc-panel');
      const close = document.querySelector('.mc-close');
      const stage = document.querySelector('.mc-stage');
      const catalog = document.getElementById('catalog');
      const slotBox = slot.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const closeBox = close.getBoundingClientRect();
      return {
        slot: slotBox.width,
        zoom: getComputedStyle(stage).zoom,
        panelRight: panelBox.right,
        panelBottom: panelBox.bottom,
        closeLeft: closeBox.left,
        closeRight: closeBox.right,
        closeTop: closeBox.top,
        closeBottom: closeBox.bottom,
        closeWidth: closeBox.width,
        catalogTouch: getComputedStyle(catalog).touchAction,
        catalogScroll: catalog.scrollHeight,
        catalogClient: catalog.clientHeight,
        scrolled: catalog.scrollTop,
      };
    })()`,
  });
  const value = (evaluated.result as { value?: InventoryMeasure } | undefined)?.value;
  if (!value) throw new Error(`inventory probe returned no value: ${JSON.stringify(evaluated)}`);
  return value;
}

class Cdp {
  private next = 0;
  private readonly pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
      };
      if (message.id === undefined) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'cdp error'));
      else waiter.resolve(message.result ?? {});
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function waitForJson(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* chrome is still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not open ${url}`);
}

let chromePort = 9600;

async function launchChrome(width: number, height: number, pageUrl: string): Promise<{
  chrome: ChildProcess;
  socket: WebSocket;
  cdp: Cdp;
  userData: string;
}> {
  const userData = mkdtempSync(join(tmpdir(), 'frontier-layout-'));
  const port = chromePort;
  chromePort += 1;
  const chrome = spawn(chromeBinary(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Headless Chrome 148's content height is 87px shorter than --window-size.
    `--window-size=${width},${height + 87}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = pages.find((entry) => entry.type === 'page');
  if (!page) throw new Error('chrome opened no page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const cdp = new Cdp(socket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Page.navigate', { url: pageUrl });
  return { chrome, socket, cdp, userData };
}

describe('coarse mobile layout rects', () => {
  let server: Server | undefined;
  const chromeJobs: Array<{ chrome: ChildProcess; userData: string }> = [];

  afterAll(async () => {
    server?.close();
    for (const job of chromeJobs) job.chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const job of chromeJobs) {
      try {
        rmSync(job.userData, { recursive: true, force: true });
      } catch {
        /* Chrome can still be flushing the profile. */
      }
    }
  });

  async function measure(width: number, height: number, pageUrl: string): Promise<LayoutSnapshot> {
    const launched = await launchChrome(width, height, pageUrl);
    chromeJobs.push(launched);
    const { cdp } = launched;
    await cdp.send('Page.navigate', { url: `${pageUrl}?w=${width}&h=${height}` });
    let sized = false;
    for (let attempt = 0; attempt < 30 && !sized; attempt += 1) {
      const probe = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'JSON.stringify({ w: window.innerWidth, h: window.innerHeight })',
      });
      const raw = (probe.result as { value?: string } | undefined)?.value;
      const size = raw ? JSON.parse(raw) as { w: number; h: number } : undefined;
      sized = size?.w === width && size?.h === height;
      if (!sized) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!sized) throw new Error(`viewport did not settle at ${width}x${height}`);
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      const probe = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: '!!document.querySelector(\'[data-action="jump"]\')',
      });
      ready = (probe.result as { value?: boolean } | undefined)?.value === true;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error(`layout page did not render at ${width}x${height}`);
    const evaluated = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const app = document.querySelector('#app');
        const slot = document.querySelector('#hotbar .slot');
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          visual: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height } : null,
          coarse: matchMedia('(pointer: coarse)').matches,
          jump: box(document.querySelector('[data-action="jump"]')),
          crouch: box(document.querySelector('[data-action="sneak"]')),
          inventory: box(document.querySelector('[data-action="inventory"]')),
          hotbar: box(document.querySelector('#hotbar')),
          slot: box(slot),
          offhand: box(document.querySelector('#offhand-hud')),
          corner: box(document.querySelector('#hud-corner')),
          stick: box(document.querySelector('#touch-joystick')),
          effect: box(document.querySelector('#effect-hud')),
          playInfo: box(document.querySelector('#play-info')),
          slotVar: getComputedStyle(app).getPropertyValue('--hotbar-slot').trim(),
          inventoryLabel: document.querySelector('[data-action="inventory"]')?.getAttribute('aria-label'),
          backpack: document.querySelector('[data-action="inventory"] svg')?.getAttribute('shape-rendering'),
        };
      })()`,
    });
    const result = evaluated.result as { value?: LayoutSnapshot & {
      coarse?: boolean;
      visual?: { width: number; height: number } | null;
      inventoryLabel?: string;
      backpack?: string;
    } };
    const value = result.value;
    if (!value) throw new Error(`layout probe returned no value: ${JSON.stringify(evaluated)}`);
    expect(value.coarse, `touch emulation should make the pointer coarse (${JSON.stringify(value.viewport)} visual ${JSON.stringify(value.visual)})`).toBe(true);
    expect(value.viewport.width, JSON.stringify(value)).toBe(width);
    expect(value.viewport.height).toBe(height);
    expect(value.visual?.width).toBe(width);
    expect(value.visual?.height).toBe(height);
    expect(value.inventoryLabel).toBe('Инвентарь');
    expect(value.backpack).toBe('crispEdges');
    return value;
  }

  it('stacks jump over crouch and enlarges the hotbar at 844x390 and 800x360', async () => {
    expect(icons).toContain('shape-rendering="crispEdges"');
    expect(icons).not.toContain('🎒');
    expect(icons).not.toContain('▦');
    const html = pageHtml();
    server = createServer((_req, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('layout server has no port');
    const pageUrl = `http://127.0.0.1:${address.port}/`;
    const wide = await measure(844, 390, pageUrl);
    const narrow = await measure(800, 360, pageUrl);
    const landscape = await measure(960, 500, pageUrl);
    assertStack(wide, 40, 68, 116, 46, 54);
    assertStack(narrow, 38, 64, 108, 40, 52);
    assertStack(landscape, 38, 72, 124, 34, 48);
  }, 90_000);

  it('sizes the creative inventory from the viewport scale alone', async () => {
    server?.close();
    const { containerUiScaleWithClose, MC_CREATIVE_WIDTH, MC_CREATIVE_HEIGHT, MC_SLOT_PITCH } = await import('../src/ui/containerTheme');
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const width = Number(url.searchParams.get('w') ?? 844);
      const height = Number(url.searchParams.get('h') ?? 390);
      const scale = containerUiScaleWithClose(width, height, MC_CREATIVE_WIDTH, MC_CREATIVE_HEIGHT);
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(inventoryHtml(scale));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('inventory server has no port');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const [width, height] of [[844, 390], [800, 360], [960, 500]] as const) {
      const scale = containerUiScaleWithClose(width, height, MC_CREATIVE_WIDTH, MC_CREATIVE_HEIGHT);
      const measured = await measureInventory(width, height, `${origin}/?w=${width}&h=${height}`, chromeJobs);
      expect(measured.slot).toBeGreaterThanOrEqual(32);
      expect(measured.slot).toBeCloseTo(MC_SLOT_PITCH * scale, 0);
      expect(measured.zoom === '1' || measured.zoom === 'normal' || Number(measured.zoom) === 1).toBe(true);
      expect(measured.panelRight).toBeLessThanOrEqual(width + 1);
      expect(measured.panelBottom).toBeLessThanOrEqual(height + 1);
      expect(measured.closeLeft).toBeGreaterThanOrEqual(0);
      expect(measured.closeRight).toBeLessThanOrEqual(width + 1);
      expect(measured.closeTop).toBeGreaterThanOrEqual(0);
      expect(measured.closeBottom).toBeLessThanOrEqual(height + 1);
      expect(measured.closeWidth).toBeGreaterThanOrEqual(44);
      expect(measured.catalogTouch).toBe('pan-y');
      expect(measured.catalogScroll).toBeGreaterThan(measured.catalogClient);
      expect(measured.scrolled).toBeGreaterThan(0);
    }
  }, 90_000);

  it('covers the sun with nearer and farther world fragments while clouds stay in front', async () => {
    server?.close();
    const threeModule = readFileSync('node_modules/three/build/three.module.js');
    const threeCore = readFileSync('node_modules/three/build/three.core.js');
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/three.module.js') {
        response.setHeader('content-type', 'text/javascript');
        response.end(threeModule);
        return;
      }
      if (url.pathname === '/three.core.js') {
        response.setHeader('content-type', 'text/javascript');
        response.end(threeCore);
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(celestialHtml());
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('celestial server has no port');
    const launched = await launchChrome(800, 360, `http://127.0.0.1:${address.port}/`);
    chromeJobs.push(launched);
    let raw: string | undefined;
    for (let attempt = 0; attempt < 40 && !raw; attempt += 1) {
      const probe = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'window.__shots ? JSON.stringify(window.__shots) : (window.__shotError || "")',
      });
      const value = (probe.result as { value?: string } | undefined)?.value;
      if (value && value.startsWith('{')) raw = value;
      else if (value) throw new Error(value);
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!raw) throw new Error('celestial render did not finish');
    const shots = JSON.parse(raw) as Record<string, { center: string; corner: string }>;
    expect(shots.near?.center).toBe('world');
    expect(shots.far?.center).toBe('world');
    expect(shots['blend-far']?.center).toBe('sun');
    expect(shots['blend-near']?.center).toBe('world');
    expect(shots.disc?.center).toBe('sun');
    expect(shots.disc?.corner).toBe('sky');
    expect(shots.cloud?.center).toBe('cloud');
  }, 60_000);

  it('anchors a creative tap on pointerup and ignores a later backdrop move', async () => {
    server?.close();
    const esbuild = await import('esbuild');
    const bundled = await esbuild.build({
      stdin: {
        contents: `
          import { GameUI } from './src/ui/GameUI.ts';
          import { Inventory } from './src/inventory/inventory.ts';
          const root = document.querySelector('#ui-root');
          const ui = new GameUI(root);
          ui.openInventory({
            kind: 'inventory',
            mode: 'creative',
            inventory: new Inventory(),
            onClose() {},
            onDrop() {},
            onChanged() {},
          });
          window.__ready = true;
        `,
        resolveDir: process.cwd(),
        sourcefile: 'creative-cursor-harness.ts',
      },
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'browser',
      define: {
        'import.meta.env': JSON.stringify({
          DEV: false,
          PROD: true,
          SSR: false,
          BASE_URL: '/',
          MODE: 'production',
        }),
      },
      plugins: [{
        name: 'virtual-skin',
        setup(build) {
          build.onResolve({ filter: /^virtual:player-skin-content-hashes$/ }, () => ({
            path: 'virtual:player-skin-content-hashes',
            namespace: 'virt',
          }));
          build.onLoad({ filter: /.*/, namespace: 'virt' }, () => ({
            contents: 'export default {};',
            loader: 'js',
          }));
        },
      }],
    });
    const harness = bundled.outputFiles[0]?.text ?? '';
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/harness.js') {
        response.setHeader('content-type', 'text/javascript');
        response.end(harness);
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body><div id="ui-root"></div><script>window.addEventListener('error', (event) => { window.__bootError = String(event.message || event.error); });</script><script type="module" src="/harness.js"></script></body></html>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('cursor server has no port');
    const launched = await launchChrome(844, 390, `http://127.0.0.1:${address.port}/`);
    chromeJobs.push(launched);
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      const probe = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'window.__ready === true && !!document.querySelector(\'[data-slot^="creative-"]\')',
      });
      ready = (probe.result as { value?: boolean } | undefined)?.value === true;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      const probe = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'JSON.stringify({ error: window.__bootError || "", html: document.body.innerHTML.slice(0, 500) })',
      });
      throw new Error(`creative inventory did not open ${JSON.stringify(probe.result)}`);
    }
    const tapped = await launched.cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const before = document.querySelector('#cursor-stack');
        const beforeLeft = before ? before.style.left : '';
        const slot = document.querySelector('[data-slot^="creative-"]');
        const box = slot.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        slot.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', button: 0, pointerId: 4,
        }));
        const pressed = document.querySelector('#cursor-stack');
        const pressedHtml = pressed.innerHTML.length;
        slot.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', button: 0, pointerId: 4,
        }));
        const cursor = document.querySelector('#cursor-stack');
        const rect = cursor.getBoundingClientRect();
        return {
          beforeLeft,
          pressedHtml,
          x,
          y,
          left: cursor.style.left,
          top: cursor.style.top,
          rectLeft: rect.left,
          rectTop: rect.top,
          html: cursor.innerHTML.length,
        };
      })()`,
    });
    const tap = (tapped.result as { value?: {
      beforeLeft: string;
      pressedHtml: number;
      x: number;
      y: number;
      left: string;
      top: string;
      rectLeft: number;
      rectTop: number;
      html: number;
    } }).value;
    if (!tap) throw new Error(`cursor tap returned nothing: ${JSON.stringify(tapped)}`);
    expect(tap.pressedHtml).toBe(0);
    expect(tap.html).toBeGreaterThan(0);
    expect(tap.x).toBeGreaterThan(0);
    expect(tap.y).toBeGreaterThan(0);
    expect(tap.left).toBe(`${tap.x + 18}px`);
    expect(tap.top).toBe(`${tap.y - 36}px`);
    expect(tap.rectLeft).toBeGreaterThan(tap.x);
    expect(tap.rectLeft).toBeLessThan(tap.x + 80);
    const moved = await launched.cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        document.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, clientX: 310, clientY: 140, pointerType: 'mouse',
        }));
        const cursor = document.querySelector('#cursor-stack');
        return { left: cursor.style.left, top: cursor.style.top };
      })()`,
    });
    const move = (moved.result as { value?: { left: string; top: string } }).value;
    expect(move).toEqual({ left: tap.left, top: tap.top });
  }, 60_000);
});

function celestialHtml(): string {
  return `<!doctype html><html><body><script type="module">
import * as THREE from '/three.module.js';
function label(rgb) {
  const [r, g, b] = rgb;
  if (r > 180 && g > 140 && b < 120) return 'sun';
  if (g > r + 15 && g > b + 15 && g > 50) return 'world';
  if (r > 180 && g > 180 && b > 180) return 'cloud';
  if (r < 50 && g < 70 && b < 90) return 'sky';
  return 'other:' + rgb.join(',');
}
function shot(mode) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(64, 64);
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x102030);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  camera.position.set(0, 0, 10);
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      if (dx * dx + dy * dy > 6.4 * 6.4) continue;
      const index = (y * 16 + x) * 4;
      data[index] = 255;
      data[index + 1] = 210;
      data[index + 2] = 40;
      data[index + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(data, 16, 16);
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  const cutout = mode !== 'blend-far' && mode !== 'blend-near';
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cutout
    ? new THREE.MeshBasicMaterial({ map, transparent: false, alphaTest: 0.5, depthWrite: false, depthTest: true })
    : new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: true }));
  disc.position.z = 0;
  disc.renderOrder = -750;
  scene.add(disc);
  if (mode === 'near' || mode === 'far' || mode === 'blend-near' || mode === 'blend-far') {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x00aa22 }));
    wall.position.z = mode === 'near' || mode === 'blend-near' ? 4 : -6;
    wall.renderOrder = 0;
    scene.add(wall);
  }
  if (mode === 'cloud') {
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 1, depthWrite: false, depthTest: true }),
    );
    cloud.position.z = 3;
    cloud.renderOrder = -500;
    scene.add(cloud);
  }
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const center = new Uint8Array(4);
  const corner = new Uint8Array(4);
  gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
  gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, corner);
  renderer.dispose();
  return { center: label([center[0], center[1], center[2]]), corner: label([corner[0], corner[1], corner[2]]) };
}
try {
  window.__shots = {
    near: shot('near'),
    far: shot('far'),
    'blend-near': shot('blend-near'),
    'blend-far': shot('blend-far'),
    disc: shot('disc'),
    cloud: shot('cloud'),
  };
} catch (error) {
  window.__shotError = String(error && error.stack || error);
}
</script></body></html>`;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

function assertStack(
  layout: LayoutSnapshot,
  minSlot: number,
  actionSize: number,
  stickSize: number,
  rightGapMin: number,
  rightGapMax: number,
): void {
  const center = (box: Box): number => (box.left + box.right) / 2;
  expect(Math.abs(center(layout.jump) - center(layout.crouch))).toBeLessThanOrEqual(1);
  expect(layout.jump.bottom).toBeLessThanOrEqual(layout.crouch.top);
  const gap = layout.crouch.top - layout.jump.bottom;
  expect(gap).toBeGreaterThanOrEqual(7);
  expect(gap).toBeLessThanOrEqual(10);
  expect(layout.jump.top).toBeGreaterThanOrEqual(0);
  expect(layout.crouch.bottom).toBeLessThanOrEqual(layout.viewport.height + 0.5);
  expect(layout.jump.right).toBeLessThanOrEqual(layout.viewport.width + 0.5);
  expect(layout.slot.width).toBeGreaterThanOrEqual(minSlot);
  expect(layout.slot.height).toBeGreaterThanOrEqual(minSlot);
  expect(layout.slot.width).toBeLessThanOrEqual(42.5);
  expect(layout.inventory.width).toBeGreaterThanOrEqual(layout.slot.width - 0.5);
  expect(layout.inventory.height).toBeGreaterThanOrEqual(layout.slot.height - 0.5);
  const rightGap = layout.inventory.left - layout.hotbar.right;
  const leftGap = layout.hotbar.left - layout.offhand.right;
  expect(rightGap).toBeGreaterThan(18);
  expect(rightGap).toBeLessThan(23);
  expect(Math.abs(rightGap - leftGap)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(layout.inventory.bottom - layout.hotbar.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.offhand.bottom - layout.hotbar.bottom)).toBeLessThanOrEqual(1);
  expect(overlaps(layout.jump, layout.crouch)).toBe(false);
  expect(overlaps(layout.jump, layout.hotbar)).toBe(false);
  expect(overlaps(layout.crouch, layout.hotbar)).toBe(false);
  expect(overlaps(layout.jump, layout.inventory)).toBe(false);
  expect(overlaps(layout.crouch, layout.inventory)).toBe(false);
  expect(overlaps(layout.jump, layout.corner)).toBe(false);
  expect(overlaps(layout.crouch, layout.corner)).toBe(false);
  expect(overlaps(layout.inventory, layout.hotbar)).toBe(false);
  expect(overlaps(layout.offhand, layout.hotbar)).toBe(false);
  expect(layout.jump.width).toBeGreaterThanOrEqual(actionSize - 1);
  expect(layout.jump.width).toBeLessThanOrEqual(actionSize + 1);
  expect(layout.crouch.width).toBeGreaterThanOrEqual(actionSize - 1);
  expect(layout.stick.width).toBeGreaterThanOrEqual(stickSize - 1);
  expect(layout.stick.height).toBeGreaterThanOrEqual(stickSize - 1);
  const rightInset = layout.viewport.width - layout.crouch.right;
  expect(rightInset).toBeGreaterThanOrEqual(rightGapMin);
  expect(rightInset).toBeLessThanOrEqual(rightGapMax);
  expect(layout.crouch.right).toBeLessThanOrEqual(layout.viewport.width - 10);
  expect(layout.viewport.height - layout.crouch.bottom).toBeGreaterThanOrEqual(36);
  expect(layout.jump.left - layout.inventory.right).toBeGreaterThanOrEqual(20);
  expect(layout.effect.bottom).toBeLessThanOrEqual(layout.jump.top + 1);
  expect(overlaps(layout.effect, layout.jump)).toBe(false);
  expect(overlaps(layout.effect, layout.crouch)).toBe(false);
  expect(overlaps(layout.stick, layout.hotbar)).toBe(false);
  expect(overlaps(layout.stick, layout.playInfo)).toBe(false);
  expect(overlaps(layout.stick, layout.jump)).toBe(false);
}
