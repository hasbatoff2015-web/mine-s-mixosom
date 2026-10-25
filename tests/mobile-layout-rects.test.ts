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

  it('keeps menu back and close inside the panel on phone and desktop viewports', async () => {
    server?.close();
    const { menuLogicalHeight, menuLogicalWidth, menuUiScale } = await import('../src/ui/containerTheme');
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const width = Number(url.searchParams.get('w') ?? 844);
      const height = Number(url.searchParams.get('h') ?? 390);
      const screen = url.searchParams.get('screen') ?? 'homes';
      const logicalWidth = menuLogicalWidth(screen);
      const scale = menuUiScale(width, height, logicalWidth, menuLogicalHeight(screen === 'trade' ? 'trade' : screen));
      const back = screen === 'root' || screen === 'trade'
        ? ''
        : '<button type="button" class="mc-close mc-back" data-menu-action="back" aria-label="Назад">←</button>';
      const chromeClass = back ? 'mc-menu-chrome' : 'mc-menu-chrome is-close-only';
      const title = screen === 'trade' ? 'Обмен' : screen === 'root' ? 'Меню' : 'Дома';
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
        :root { --touch-target: 44px; }
        html, body, #app { margin: 0; width: 100%; height: 100%; }
        ${style}
      </style></head><body><div id="app">
        <div class="modal-backdrop mc-backdrop">
          <div class="mc-stage mc-menu-stage" style="--mc-ui-scale:${scale}; --mc-logical-width:${logicalWidth}">
            <div class="mc-panel mc-menu-panel" data-menu-panel>
              <div class="${chromeClass}">
                ${back}
                <button type="button" class="mc-close" data-ui="close" aria-label="Закрыть"><span class="mc-close-x">×</span></button>
              </div>
              <div class="mc-menu-body">
                <div class="mc-menu-heading">${title}</div>
                <form class="mc-menu-form">
                  <label class="mc-ah-field">Название
                    <input type="text" data-menu-field value="дом" />
                  </label>
                  <button type="button" class="mc-ah-btn" data-menu-submit>Создать</button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div></body></html>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('menu server has no port');
    const origin = `http://127.0.0.1:${address.port}`;
    const viewports = [
      [844, 390],
      [932, 430],
      [740, 360],
      [390, 844],
      [1280, 720],
      [1920, 1080],
    ] as const;
    for (const screen of ['homes', 'trade', 'root'] as const) {
      for (const [width, height] of viewports) {
        const launched = await launchChrome(width, height, 'about:blank');
        chromeJobs.push(launched);
        await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await launched.cdp.send('Page.navigate', { url: `${origin}/?w=${width}&h=${height}&screen=${screen}` });
        let ready = false;
        let seen = '';
        for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
          const probe = await launched.cdp.send('Runtime.evaluate', {
            returnByValue: true,
            expression: 'JSON.stringify({ w: window.innerWidth, h: window.innerHeight, panel: !!document.querySelector("[data-menu-panel]") })',
          });
          seen = (probe.result as { value?: string } | undefined)?.value ?? '';
          const parsed = seen.startsWith('{') ? JSON.parse(seen) as { w: number; h: number; panel: boolean } : undefined;
          ready = parsed?.panel === true && parsed.w === width && parsed.h === height;
          if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!ready) throw new Error(`menu did not render for ${screen} ${width}x${height}: ${seen}`);
        const evaluated = await launched.cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const overlaps = (a, b) => !!a && !!b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
            const box = (node) => {
              if (!node) return null;
              const rect = node.getBoundingClientRect();
              return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
            };
            const panel = document.querySelector('[data-menu-panel]');
            const headingNode = document.querySelector('.mc-menu-heading');
            const headingRange = document.createRange();
            if (headingNode) headingRange.selectNodeContents(headingNode);
            const heading = headingNode ? { getBoundingClientRect: () => headingRange.getBoundingClientRect() } : null;
            const back = document.querySelector('.mc-back');
            const close = document.querySelector('[data-ui="close"]');
            const field = document.querySelector('[data-menu-field]');
            const submit = document.querySelector('[data-menu-submit]');
            const panelBox = box(panel);
            const headingBox = box(heading);
            const backBox = box(back);
            const closeBox = box(close);
            const fieldBox = box(field);
            const submitBox = box(submit);
            return {
              panel: panelBox,
              heading: headingBox,
              back: backBox,
              close: closeBox,
              field: fieldBox,
              backOverlapsHeading: overlaps(backBox, headingBox),
              closeOverlapsHeading: overlaps(closeBox, headingBox),
              closeOverlapsField: overlaps(closeBox, fieldBox),
              backInsidePanel: !backBox || (backBox.left >= panelBox.left - 1 && backBox.right <= panelBox.right + 1 && backBox.top >= panelBox.top - 1),
              closeInsidePanel: closeBox.left >= panelBox.left - 1 && closeBox.right <= panelBox.right + 1 && closeBox.top >= panelBox.top - 1,
              panelInside: panelBox.left >= -1 && panelBox.top >= -1 && panelBox.right <= window.innerWidth + 1 && panelBox.bottom <= window.innerHeight + 1,
              overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
              headingWidth: headingBox.width,
              closeWidth: closeBox.width,
              submitWidth: submitBox.width,
              viewport: { width: window.innerWidth, height: window.innerHeight },
            };
          })()`,
        });
        const value = (evaluated.result as { value?: {
          backOverlapsHeading: boolean;
          closeOverlapsHeading: boolean;
          closeOverlapsField: boolean;
          backInsidePanel: boolean;
          closeInsidePanel: boolean;
          panelInside: boolean;
          overflowX: boolean;
          headingWidth: number;
          closeWidth: number;
          submitWidth: number;
          panel: { width: number; height: number };
          viewport: { width: number; height: number };
        } } | undefined)?.value;
        expect(value, `${screen} ${width}x${height}`).toBeTruthy();
        expect(value!.viewport).toEqual({ width, height });
        expect(value!.backOverlapsHeading, JSON.stringify(value)).toBe(false);
        expect(value!.closeOverlapsHeading, JSON.stringify(value)).toBe(false);
        expect(value!.closeOverlapsField, JSON.stringify(value)).toBe(false);
        expect(value!.backInsidePanel, JSON.stringify(value)).toBe(true);
        expect(value!.closeInsidePanel, JSON.stringify(value)).toBe(true);
        expect(value!.panelInside, JSON.stringify(value)).toBe(true);
        expect(value!.overflowX, JSON.stringify(value)).toBe(false);
        expect(value!.headingWidth).toBeGreaterThan(20);
        expect(value!.closeWidth).toBeGreaterThanOrEqual(32);
        expect(value!.submitWidth).toBeGreaterThan(20);
        expect(value!.panel.width).toBeGreaterThan(80);
        expect(value!.panel.height).toBeGreaterThan(40);
      }
    }
  }, 180_000);

  it('keeps the root menu as wide as its logical scale instead of a narrow column', async () => {
    server?.close();
    const { menuLogicalHeight, menuLogicalWidth, menuUiScale } = await import('../src/ui/containerTheme');
    const { menuChromeHtml, menuRootHtml, overlayStageStyle } = await import('../src/ui/gameMenuGui');
    const body = menuRootHtml({ balance: 1200, balanceLabel: '1.2K' });
    const close = '<button type="button" class="mc-close" data-ui="close" aria-label="Закрыть"><span class="mc-close-x">×</span></button>';
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const width = Number(url.searchParams.get('w') ?? 1280);
      const height = Number(url.searchParams.get('h') ?? 720);
      const logicalWidth = menuLogicalWidth('root', width);
      const scale = menuUiScale(width, height, logicalWidth, menuLogicalHeight('root'));
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
        :root { --touch-target: 44px; }
        html, body, #app { margin: 0; width: 100%; height: 100%; }
        ${style}
      </style></head><body><div id="app">
        <div class="modal-backdrop mc-backdrop">
          <div class="mc-stage mc-menu-stage" data-root-stage style="${overlayStageStyle(scale, logicalWidth)}">
            <div class="mc-panel mc-menu-panel" data-menu-panel>
              ${menuChromeHtml('', close)}
              ${body}
            </div>
          </div>
        </div>
      </div></body></html>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('root menu server has no port');
    const origin = `http://127.0.0.1:${address.port}`;
    const viewports = [
      [640, 360],
      [667, 375],
      [740, 360],
      [800, 360],
      [844, 390],
      [932, 430],
      [1280, 720],
      [1600, 900],
      [1920, 1080],
    ] as const;
    const launched = await launchChrome(1280, 720, 'about:blank');
    chromeJobs.push(launched);
    for (const [width, height] of viewports) {
      const logicalWidth = menuLogicalWidth('root', width);
      const scale = menuUiScale(width, height, logicalWidth, menuLogicalHeight('root'));
      const expected = Math.min(logicalWidth * scale, width - 16);
      await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await launched.cdp.send('Page.navigate', { url: `${origin}/?w=${width}&h=${height}` });
      let ready = false;
      for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
        const probe = await launched.cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: 'document.querySelectorAll(".mc-menu-tile").length',
        });
        ready = (probe.result as { value?: number } | undefined)?.value === 10
          && await launched.cdp.send('Runtime.evaluate', {
            returnByValue: true,
            expression: 'window.innerWidth',
          }).then((value) => (value.result as { value?: number } | undefined)?.value === width);
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (!ready) throw new Error(`root menu did not render at ${width}x${height}`);
      const evaluated = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const box = (node) => {
            const rect = node.getBoundingClientRect();
            return { width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
          };
          const stage = document.querySelector('[data-root-stage]');
          const panel = document.querySelector('[data-menu-panel]');
          const menuBody = document.querySelector('.mc-menu-body');
          const tiles = [...document.querySelectorAll('.mc-menu-tile')].map(box);
          const close = document.querySelector('[data-ui="close"]');
          const heading = document.querySelector('.mc-menu-heading');
          const balance = document.querySelector('.mc-menu-balance');
          const stageStyle = getComputedStyle(stage);
          return {
            stage: box(stage),
            panel: box(panel),
            body: box(menuBody),
            tiles,
            close: box(close),
            heading: box(heading),
            balance: box(balance),
            scale: stageStyle.getPropertyValue('--mc-ui-scale').trim(),
            logical: stageStyle.getPropertyValue('--mc-logical-width').trim(),
            panelShrink: getComputedStyle(panel).flexShrink,
            overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
            bodyScroll: menuBody.scrollHeight - menuBody.clientHeight,
            closeInside: close.getBoundingClientRect().left >= panel.getBoundingClientRect().left - 1
              && close.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 1
              && close.getBoundingClientRect().top >= panel.getBoundingClientRect().top - 1,
            closeOverlapsHeading: (() => {
              const range = document.createRange();
              range.selectNodeContents(heading);
              const text = range.getBoundingClientRect();
              const button = close.getBoundingClientRect();
              return text.width > 0 && button.left < text.right - 1 && button.right > text.left + 1
                && button.top < text.bottom - 1 && button.bottom > text.top + 1;
            })(),
          };
        })()`,
      });
      const value = (evaluated.result as { value?: {
        panel: { width: number; height: number };
        tiles: Array<{ width: number; height: number; bottom: number }>;
        close: { width: number; height: number };
        scale: string;
        overflowX: boolean;
        bodyScroll: number;
        closeInside: boolean;
        closeOverlapsHeading: boolean;
        body: { bottom: number };
      } } | undefined)?.value;
      expect(value, `${width}x${height}`).toBeTruthy();
      expect(value!.overflowX, `${width}x${height}`).toBe(false);
      expect(value!.panel.width, `${width}x${height} panel`).toBeGreaterThan(expected - 24);
      expect(value!.panel.width, `${width}x${height} panel cap`).toBeLessThan(expected + 24);
      expect(value!.tiles, `${width}x${height}`).toHaveLength(10);
      const tileWidth = value!.tiles[0]!.width;
      expect(tileWidth, `${width}x${height} tile`).toBeGreaterThan(expected / 4);
      expect(Math.abs(value!.tiles[0]!.height - 56 * scale), `${width}x${height} tile height`).toBeLessThan(8);
      expect(value!.tiles.every((tile) => Math.abs(tile.width - tileWidth) < 2), `${width}x${height} tile widths`).toBe(true);
      expect(value!.closeInside, `${width}x${height}`).toBe(true);
      expect(value!.closeOverlapsHeading, `${width}x${height}`).toBe(false);
      expect(value!.close.width, `${width}x${height}`).toBeGreaterThanOrEqual(32);
      if (height >= 720) {
        expect(value!.bodyScroll, `${width}x${height} scroll`).toBeLessThan(2);
        expect(value!.tiles[9]!.bottom, `${width}x${height} last tile`).toBeLessThanOrEqual(value!.body.bottom + 2);
      }
    }
  }, 90_000);

  it('keeps donate text readable and inside the viewport', async () => {
    server?.close();
    const { menuLogicalWidth, menuUiScale } = await import('../src/ui/containerTheme');
    const { menuDonateHtml } = await import('../src/ui/donateMenuGui');
    const { menuBackHtml, menuChromeHtml, overlayStageStyle } = await import('../src/ui/gameMenuGui');
    const escape = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const baseDonate = {
      rankLabel: 'VIP',
      summary: '',
      remainingLabel: 'Осталось 3 дня до конца привилегии',
      perks: [{ title: 'Дома', detail: '4/10' }, { title: 'Приваты', detail: '2/4' }],
      actions: [
        { id: 'tp', label: 'Телепорт по координатам', available: true, detail: 'Доступно с привилегии TITAN. Длинная подпись цены 500 Мегакоинов', screen: 'donate-tp' as const },
        { id: 'announce', label: 'Объявление на сервер', available: true, detail: 'Раз в час', screen: 'donate-announce' as const },
        { id: 'nickcolor', label: 'Цвет ника', available: true, detail: 'PREMIUM', screen: 'donate-color' as const },
        { id: 'kits', label: 'Наборы', available: true, detail: 'Стартовые и ранговые наборы', screen: 'donate-kits' as const },
        { id: 'pets', label: 'Питомцы', available: true, detail: 'Пчёлка и мини-крипер', screen: 'donate-pets' as const },
      ],
      kits: [
        { name: 'vip', label: 'Набор VIP', available: true, detail: 'Можно получить' },
        { name: 'titan', label: 'Набор TITAN с очень длинным названием', available: false, detail: 'Можно получить через 2 часа' },
      ],
      pets: [
        { id: 'bee' as const, label: 'Пчёлка', available: true, summoned: false, actionLabel: 'Призвать пчёлку', detail: 'Летает рядом' },
        { id: 'creeper' as const, label: 'Мини-крипер', available: false, summoned: false, actionLabel: 'Призвать', detail: 'Нужна привилегия TITAN' },
      ],
      catalog: [{ title: 'VIP', detail: 'Дома 4' }, { title: 'PREMIUM', detail: 'Цвет ника' }, { title: 'BOSS', detail: 'Питомцы' }, { title: 'TITAN', detail: 'Телепорт' }],
      nickChoices: ['white', 'red', 'gold', 'green', 'aqua', 'blue', 'purple'],
      nickColor: 'gold',
      previewName: 'ДлинноеИмяИгрока',
      onlinePlayers: [],
      showInvseeOp: false,
    };
    const screens = ['donate', 'donate-pets', 'donate-kits', 'donate-color', 'donate-announce', 'donate-tp'] as const;
    const panels = (width: number, height: number) => screens.map((screen) => {
      const logicalWidth = menuLogicalWidth(screen, width);
      const scale = menuUiScale(width, height, logicalWidth, 360);
      const body = menuDonateHtml({
        type: 'menu',
        screen,
        title: 'Донат',
        donate: baseDonate,
      }, escape);
      return `<section data-donate-panel="${screen}" data-scale="${scale}" data-logical="${logicalWidth}">
        <div class="modal-backdrop mc-backdrop">
          <div class="mc-stage mc-menu-stage" style="${overlayStageStyle(scale, logicalWidth)}">
            <div class="mc-panel mc-menu-panel" data-menu-panel>
              ${menuChromeHtml(menuBackHtml(screen), '<button type="button" class="mc-close" data-ui="close" aria-label="Закрыть"><span class="mc-close-x">×</span></button>')}
              ${body}
            </div>
          </div>
        </div>
      </section>`;
    }).join('');
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const width = Number(url.searchParams.get('w') ?? 844);
      const height = Number(url.searchParams.get('h') ?? 390);
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
        :root { --touch-target: 44px; }
        html, body, #app { margin: 0; }
        ${style}
      </style></head><body><div id="app">${panels(width, height)}</div></body></html>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('donate server has no port');
    const origin = `http://127.0.0.1:${address.port}`;
    const viewports = [
      [390, 844],
      [640, 360],
      [667, 375],
      [740, 360],
      [844, 390],
      [932, 430],
      [1280, 720],
      [1920, 1080],
    ] as const;
    const launched = await launchChrome(844, 390, 'about:blank');
    chromeJobs.push(launched);
    const measure = `(() => {
      const parsePx = (value) => Number.parseFloat(value);
      const panels = [...document.querySelectorAll('[data-donate-panel]')].map((panel) => {
        const texts = [...panel.querySelectorAll('.mc-donate-rank strong, .mc-donate-rank span, .mc-donate-card strong, .mc-donate-card span, .mc-donate-chip, .mc-donate-preview, .mc-donate-coords input, textarea, .mc-menu-heading, .mc-player-meta')];
        const fonts = texts.filter((node) => node.textContent.trim().length > 0 || node.matches('input, textarea')).map((node) => ({
          tag: node.tagName,
          cls: node.className || '',
          size: parsePx(getComputedStyle(node).fontSize),
        }));
        const cards = [...panel.querySelectorAll('.mc-donate-card')].map((card) => ({
          scroll: card.scrollWidth,
          client: card.clientWidth,
          height: card.getBoundingClientRect().height,
        }));
        const swatch = panel.querySelector('.mc-donate-swatch')?.getBoundingClientRect();
        const button = panel.querySelector('.mc-ah-btn, .mc-donate-card')?.getBoundingClientRect();
        const back = panel.querySelector('.mc-back')?.getBoundingClientRect();
        const close = panel.querySelector('[data-ui="close"]')?.getBoundingClientRect();
        const shell = panel.querySelector('[data-menu-panel]');
        return {
          screen: panel.getAttribute('data-donate-panel'),
          fonts,
          cards,
          swatch: swatch ? swatch.width : 0,
          buttonHeight: button ? button.height : 0,
          backTop: back ? back.top : null,
          closeTop: close ? close.top : null,
          closeRight: close ? close.right : null,
          panelOverflow: shell ? shell.scrollWidth > shell.clientWidth + 1 : false,
          screenName: panel.querySelector('[data-menu-screen]')?.getAttribute('data-menu-screen'),
        };
      });
      return {
        panels,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    })()`;
    for (const [width, height] of viewports) {
      await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await launched.cdp.send('Page.navigate', { url: `${origin}/?w=${width}&h=${height}` });
      let ready = false;
      let seen = '';
      for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
        const probe = await launched.cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: 'JSON.stringify({ w: window.innerWidth, h: window.innerHeight, panels: document.querySelectorAll("[data-donate-panel]").length })',
        });
        seen = (probe.result as { value?: string } | undefined)?.value ?? '';
        const parsed = seen.startsWith('{') ? JSON.parse(seen) as { w: number; h: number; panels: number } : undefined;
        ready = parsed?.panels === screens.length && parsed.w === width && parsed.h === height;
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ready) throw new Error(`donate did not render at ${width}x${height}: ${seen}`);
      const evaluated = await launched.cdp.send('Runtime.evaluate', { returnByValue: true, expression: measure });
      const value = (evaluated.result as { value?: {
        overflowX: boolean;
        viewport: { width: number; height: number };
        panels: Array<{
          screen: string;
          fonts: Array<{ tag: string; cls: string; size: number }>;
          cards: Array<{ scroll: number; client: number; height: number }>;
          swatch: number;
          buttonHeight: number;
          closeRight: number | null;
          panelOverflow: boolean;
          screenName: string;
        }>;
      } } | undefined)?.value;
      expect(value, `${width}x${height}`).toBeTruthy();
      expect(value!.overflowX, `${width}x${height}`).toBe(false);
      for (const panel of value!.panels) {
        expect(panel.screenName, panel.screen).toBe(panel.screen);
        expect(panel.panelOverflow, JSON.stringify(panel)).toBe(false);
        expect(panel.fonts.length, panel.screen).toBeGreaterThan(0);
        for (const font of panel.fonts) {
          const floor = font.tag === 'STRONG' || font.cls.includes('mc-menu-heading') || font.cls.includes('mc-donate-preview')
            ? 13
            : 12;
          expect(font.size, `${panel.screen} ${font.cls || font.tag} at ${width}x${height}`).toBeGreaterThanOrEqual(floor);
        }
        for (const card of panel.cards) {
          expect(card.scroll, panel.screen).toBeLessThanOrEqual(card.client + 1);
          expect(card.height, panel.screen).toBeGreaterThanOrEqual(44);
        }
        if (panel.screen === 'donate-color') expect(panel.swatch).toBeGreaterThanOrEqual(44);
        if (panel.closeRight !== null) expect(panel.closeRight).toBeLessThanOrEqual(width + 1);
      }
    }
    await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844,
      height: 390,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await launched.cdp.send('Page.navigate', { url: `${origin}/?w=844&h=390` });
    let announceReady = false;
    for (let attempt = 0; attempt < 40 && !announceReady; attempt += 1) {
      const probe = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'document.querySelector("[data-donate-announce]") ? "yes" : ""',
      });
      announceReady = (probe.result as { value?: string } | undefined)?.value === 'yes';
      if (!announceReady) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!announceReady) throw new Error('donate announce field missing before resize');
    await launched.cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const field = document.querySelector('[data-donate-announce]');
        field.focus();
        field.value = 'привет';
        field.dataset.keep = '1';
        window.__field = field;
      })()`,
    });
    for (const [width, height] of [[667, 375], [932, 430]] as const) {
      const logicalWidth = menuLogicalWidth('donate-announce', width);
      const scale = menuUiScale(width, height, logicalWidth, 360);
      await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const resized = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const stage = document.querySelector('[data-donate-panel="donate-announce"] .mc-stage');
          stage.style.setProperty('--mc-ui-scale', '${scale}');
          stage.style.setProperty('--mc-logical-width', '${logicalWidth}');
          const field = document.querySelector('[data-donate-announce]');
          return {
            same: field === window.__field,
            value: field.value,
            keep: field.dataset.keep,
            screen: document.querySelector('[data-donate-panel="donate-announce"] [data-menu-screen]').getAttribute('data-menu-screen'),
            scale: getComputedStyle(stage).getPropertyValue('--mc-ui-scale').trim(),
          };
        })()`,
      });
      const live = (resized.result as { value?: {
        same: boolean;
        value: string;
        keep: string;
        screen: string;
        scale: string;
      } } | undefined)?.value;
      expect(live, `${width}x${height}`).toMatchObject({
        same: true,
        value: 'привет',
        keep: '1',
        screen: 'donate-announce',
        scale: String(scale),
      });
    }
  }, 120_000);

  it('scrolls the creative catalog from a real touch without selecting or double-scrolling', async () => {
    server?.close();
    server = createServer((_request, response) => {
      const slots = Array.from({ length: 90 }, (_unused, index) => (
        `<button type="button" class="mc-slot" data-slot="creative-${index}">${index}</button>`
      )).join('');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><style>:root{--touch-target:44px;--mc-ui-scale:2;--mc-slot:36px}${style}</style></head><body>
        <div class="modal-backdrop mc-backdrop"><div class="mc-creative-catalog" id="catalog" data-creative-catalog>${slots}</div></div>
        <script>
          const catalog = document.getElementById('catalog');
          const trace = [];
          let grants = 0;
          let base = 0;
          let y = 0;
          let active = -1;
          window.__trace = () => trace.join(',');
          catalog.addEventListener('pointerdown', (event) => {
            const slot = event.target.closest('[data-slot]');
            trace.push('down:' + (slot ? 'slot' : 'miss') + ':' + catalog.scrollTop);
            if (!slot) return;
            base = catalog.scrollTop;
            y = event.clientY;
            active = event.pointerId;
          });
          catalog.addEventListener('pointermove', (event) => {
            if (event.pointerId !== active) return;
            y = Math.max(y, Math.abs(event.clientY - y) > 8 ? y : y);
          });
          catalog.addEventListener('click', (event) => {
            const delta = Math.abs(catalog.scrollTop - base);
            trace.push('click:' + (event.target.closest('[data-slot]') ? 'slot' : 'miss') + ':' + delta);
            if (!event.target.closest('[data-slot]')) return;
            if (delta > 2) return;
            grants += 1;
          });
          catalog.addEventListener('pointercancel', () => { active = -1; });
          window.__catalogGrants = () => grants;
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('catalog server has no port');
    const launched = await launchChrome(844, 390, 'about:blank');
    chromeJobs.push(launched);
    await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
    });
    await launched.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await launched.cdp.send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` });
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      const probe = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: '!!document.querySelector("[data-slot]")',
      });
      ready = (probe.result as { value?: boolean } | undefined)?.value === true;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('catalog touch page did not render');
    const spot = await launched.cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const slot = document.querySelector('[data-slot]');
        const box = slot.getBoundingClientRect();
        const catalog = document.getElementById('catalog');
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, before: catalog.scrollTop, max: catalog.scrollHeight - catalog.clientHeight };
      })()`,
    });
    const point = (spot.result as { value?: { x: number; y: number; before: number; max: number } } | undefined)?.value;
    expect(point && point.max).toBeGreaterThan(20);
    const steps = 8;
    await launched.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point!.x, y: point!.y, id: 1 }],
    });
    for (let step = 1; step <= steps; step += 1) {
      await launched.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point!.x, y: point!.y - step * 18, id: 1 }],
      });
    }
    await launched.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const after = await launched.cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `JSON.stringify({ top: document.getElementById('catalog').scrollTop, grants: window.__catalogGrants() })`,
    });
    const result = JSON.parse((after.result as { value?: string } | undefined)?.value ?? '{}') as { top: number; grants: number };
    expect(result.top).toBeGreaterThan(point!.before);
    expect(result.top).toBeLessThan(point!.before + steps * 18 * 2);
    expect(result.grants).toBe(0);
  }, 60_000);

  it('keeps the live boss bar clear of the corner buttons', async () => {
    server?.close();
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><style>${style}</style></head><body><div id="app"><div id="hud">
        <div id="boss-bar"><span>Босс</span><div class="boss-bar-track"><span></span></div></div>
        <div id="hud-corner">
          <button type="button" id="hud-pause">Пауза</button>
          <button type="button" id="hud-chat">Чат</button>
          <button type="button" id="hud-menu">Меню</button>
          <button type="button" id="hud-emote">Эмоции</button>
        </div>
      </div></div></body></html>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('boss server has no port');
    const origin = `http://127.0.0.1:${address.port}/`;
    for (const [width, height] of [[640, 360], [667, 375], [740, 360], [844, 390], [932, 430], [1280, 720], [1920, 1080]] as const) {
      const launched = await launchChrome(width, height, 'about:blank');
      chromeJobs.push(launched);
      await launched.cdp.send('Page.navigate', { url: origin });
      await launched.cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      });
      let seen = '';
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        const probe = await launched.cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: 'JSON.stringify({ w: innerWidth, h: innerHeight, bar: !!document.querySelector("#boss-bar:not(.hidden)") })',
        });
        seen = (probe.result as { value?: string } | undefined)?.value ?? '';
        const parsed = seen.startsWith('{') ? JSON.parse(seen) as { w: number; h: number; bar: boolean } : undefined;
        ready = parsed?.bar === true && parsed.w === width && parsed.h === height;
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (!ready) throw new Error(`boss bar page ${width}x${height}: ${seen}`);
      const measured = await launched.cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const bar = document.querySelector('#boss-bar').getBoundingClientRect();
          const corner = document.querySelector('#hud-corner').getBoundingClientRect();
          const overlap = bar.left < corner.right - 1 && bar.right > corner.left + 1 && bar.top < corner.bottom - 1 && bar.bottom > corner.top + 1;
          return { overlap, barRight: bar.right, cornerLeft: corner.left, width: bar.width };
        })()`,
      });
      const value = (measured.result as { value?: { overlap: boolean; width: number } } | undefined)?.value;
      expect(value, `${width}x${height}`).toBeTruthy();
      expect(value!.overlap, JSON.stringify(value)).toBe(false);
      expect(value!.width).toBeGreaterThan(40);
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
