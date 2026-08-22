import { CHUNK_SIZE, chunkKey, floorDiv } from './constants';

export type WorldLoadPhase =
  | 'session'
  | 'spawn'
  | 'generate'
  | 'light'
  | 'mesh'
  | 'warmup'
  | 'ready'
  | 'error';

export interface WorldLoadSnapshot {
  readonly phase: WorldLoadPhase;
  readonly generated: number;
  readonly generateTotal: number;
  readonly lit: number;
  readonly litTotal: number;
  readonly meshed: number;
  readonly meshTotal: number;
  readonly error?: string;
}

export interface WorldLoadView {
  readonly phase: WorldLoadPhase;
  readonly percent: number;
  readonly label: string;
  readonly detail: string;
}

const PHASE_LABELS: Record<WorldLoadPhase, string> = {
  session: 'Подготовка мира',
  spawn: 'Ищем точку появления',
  generate: 'Генерируем чанки',
  light: 'Считаем освещение',
  mesh: 'Строим геометрию',
  warmup: 'Прогреваем рендер',
  ready: 'Мир готов',
  error: 'Не удалось загрузить мир',
};

export function chunksInSquareRadius(radius: number): number {
  const span = Math.max(0, Math.floor(radius)) * 2 + 1;
  return span * span;
}

export function initialReadyChunkRadius(renderDistance: number): number {
  return Math.max(1, Math.floor(renderDistance));
}

export function worldLoadPercent(snapshot: WorldLoadSnapshot): number {
  if (snapshot.phase === 'error') return snapshot.generated > 0 ? 97 : 0;
  if (snapshot.phase === 'ready') return 100;
  const generateTotal = Math.max(1, snapshot.generateTotal);
  const litTotal = Math.max(1, snapshot.litTotal);
  const meshTotal = Math.max(1, snapshot.meshTotal);
  const generatePart = Math.min(1, snapshot.generated / generateTotal);
  const lightPart = Math.min(1, snapshot.lit / litTotal);
  const meshPart = Math.min(1, snapshot.meshed / meshTotal);
  const weighted = 8 + generatePart * 42 + lightPart * 18 + meshPart * 27;
  const phaseFloor: Record<WorldLoadPhase, number> = {
    session: 4,
    spawn: 8,
    generate: 10,
    light: 52,
    mesh: 70,
    warmup: 95,
    ready: 100,
    error: 0,
  };
  return Math.max(phaseFloor[snapshot.phase], Math.min(99, weighted));
}

export function monotonicPercent(previous: number, next: number): number {
  if (next >= 100) return 100;
  return Math.max(0, Math.min(99, Math.max(previous, next)));
}

export function worldLoadView(snapshot: WorldLoadSnapshot, percent: number): WorldLoadView {
  const label = PHASE_LABELS[snapshot.phase];
  const detail = snapshot.phase === 'error'
    ? (snapshot.error ?? 'Неизвестная ошибка генерации')
    : snapshot.phase === 'ready'
      ? '100%'
      : `${Math.round(percent)}%`;
  return { phase: snapshot.phase, percent, label, detail };
}

export function forEachChunkInRadius(
  blockX: number,
  blockZ: number,
  radius: number,
  visit: (chunkX: number, chunkZ: number, distanceSq: number) => void,
): void {
  const centerX = floorDiv(blockX, CHUNK_SIZE);
  const centerZ = floorDiv(blockZ, CHUNK_SIZE);
  const r = Math.max(0, Math.floor(radius));
  for (let dz = -r; dz <= r; dz += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      visit(centerX + dx, centerZ + dz, dx * dx + dz * dz);
    }
  }
}

export function requiredChunkKeys(blockX: number, blockZ: number, radius: number): string[] {
  const keys: Array<{ key: string; distanceSq: number }> = [];
  forEachChunkInRadius(blockX, blockZ, radius, (chunkX, chunkZ, distanceSq) => {
    keys.push({ key: chunkKey(chunkX, chunkZ), distanceSq });
  });
  keys.sort((a, b) => a.distanceSq - b.distanceSq);
  return keys.map((entry) => entry.key);
}
