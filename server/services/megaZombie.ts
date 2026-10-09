import { WORLD_HEIGHT } from '../../src/core/constants';
import {
  MEGA_ZOMBIE_CYCLE_SECONDS,
  MEGA_ZOMBIE_LIFETIME_SECONDS,
  MEGA_ZOMBIE_SPAWN_TEXT,
  MEGA_ZOMBIE_TIMEOUT_TEXT,
  MEGA_ZOMBIE_WARNING_LEAD_SECONDS,
  MEGA_ZOMBIE_WARNING_TEXT,
  arenaFromCorners,
  isFinitePoint,
  megaZombieKillText,
  type ArenaAabb,
  type ArenaPoint,
} from '../../src/entities/megaZombie';
import { rollMegaZombieLoot } from '../../src/entities/megaZombieLoot';

export interface MegaZombiePersisted {
  spawn: ArenaPoint | null;
  pos1: ArenaPoint | null;
  pos2: ArenaPoint | null;
  cycleSeconds: number;
  warned: boolean;
}

export interface MegaZombieBossView {
  readonly id: string;
  readonly alive: boolean;
  readonly dying: boolean;
  readonly ageSeconds: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lastAttackerName: string | null;
}

export interface MegaZombieHost {
  broadcast(text: string): void;
  log(message: string): void;
  load(): MegaZombiePersisted;
  save(state: MegaZombiePersisted): void;
  findBoss(): MegaZombieBossView | undefined;
  /** Returns false when a boss already exists or the spawn was rejected. */
  spawnBoss(position: ArenaPoint, arena: ArenaAabb): boolean;
  despawnBoss(): void;
  dropLoot(x: number, y: number, z: number): void;
  launchFireworks(x: number, y: number, z: number): void;
  random(): number;
}

const EMPTY: MegaZombiePersisted = {
  spawn: null,
  pos1: null,
  pos2: null,
  cycleSeconds: 0,
  warned: false,
};

function point(value: unknown): ArenaPoint | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  const next = { x: Number(record.x), y: Number(record.y), z: Number(record.z) };
  return isFinitePoint(next) ? next : null;
}

export function sanitizeMegaZombiePersisted(value: unknown): MegaZombiePersisted {
  const record = value && typeof value === 'object' ? value as Partial<MegaZombiePersisted> : {};
  const cycle = Number(record.cycleSeconds);
  return {
    spawn: point(record.spawn),
    pos1: point(record.pos1),
    pos2: point(record.pos2),
    cycleSeconds: Number.isFinite(cycle) && cycle > 0 ? cycle : 0,
    warned: record.warned === true,
  };
}

export function formatArenaPoint(label: string, value: ArenaPoint | null): string {
  if (!value) return `${label}: не задана`;
  return `${label}: ${value.x.toFixed(2)} ${value.y.toFixed(2)} ${value.z.toFixed(2)}`;
}

export function formatArenaAabb(arena: ArenaAabb | undefined): string {
  if (!arena) return 'AABB: не задана';
  return `AABB: ${arena.minX.toFixed(2)} ${arena.minY.toFixed(2)} ${arena.minZ.toFixed(2)} → ${arena.maxX.toFixed(2)} ${arena.maxY.toFixed(2)} ${arena.maxZ.toFixed(2)}`;
}

function formatRemaining(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * One scheduler for the arena boss. WorldInstance calls tick once per
 * simulation step. enable/disable does not start another timer.
 */
export class MegaZombieService {
  enabled = false;
  private state: MegaZombiePersisted;
  private rewardPending = false;
  private saveAccumulator = 0;

  constructor(private readonly host: MegaZombieHost) {
    this.state = sanitizeMegaZombiePersisted(host.load());
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  get persisted(): MegaZombiePersisted {
    return {
      spawn: this.state.spawn ? { ...this.state.spawn } : null,
      pos1: this.state.pos1 ? { ...this.state.pos1 } : null,
      pos2: this.state.pos2 ? { ...this.state.pos2 } : null,
      cycleSeconds: this.state.cycleSeconds,
      warned: this.state.warned,
    };
  }

  arena(): ArenaAabb | undefined {
    if (!this.state.pos1 || !this.state.pos2) return undefined;
    return arenaFromCorners(this.state.pos1, this.state.pos2);
  }

  setSpawn(point: ArenaPoint): { ok: true; message: string } | { ok: false; message: string } {
    if (!isFinitePoint(point)) return { ok: false, message: 'Некорректная позиция.' };
    if (!this.insideWorld(point)) return { ok: false, message: 'Позиция вне мира.' };
    this.state.spawn = { x: point.x, y: point.y, z: point.z };
    this.persist();
    return { ok: true, message: `Точка появления: ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${point.z.toFixed(2)}` };
  }

  setPos(which: 'pos1' | 'pos2', point: ArenaPoint): { ok: true; message: string } | { ok: false; message: string } {
    if (!isFinitePoint(point)) return { ok: false, message: 'Некорректная позиция.' };
    if (!this.insideWorld(point)) return { ok: false, message: 'Позиция вне мира.' };
    this.state[which] = { x: point.x, y: point.y, z: point.z };
    this.persist();
    const label = which === 'pos1' ? 'pos1' : 'pos2';
    return { ok: true, message: `${label}: ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${point.z.toFixed(2)}` };
  }

  infoLines(): string[] {
    const arena = this.arena();
    const boss = this.host.findBoss();
    let bossLine = 'Состояние: босса нет';
    if (boss?.dying) bossLine = 'Состояние: босс умирает';
    else if (boss?.alive) {
      const left = Math.max(0, MEGA_ZOMBIE_LIFETIME_SECONDS - boss.ageSeconds);
      bossLine = `Состояние: босс активен, HP ${Math.max(0, Math.ceil(boss.health))}/${Math.ceil(boss.maxHealth)}, осталось ${formatRemaining(left)}`;
    }
    return [
      formatArenaPoint('spawn', this.state.spawn),
      formatArenaPoint('pos1', this.state.pos1),
      formatArenaPoint('pos2', this.state.pos2),
      formatArenaAabb(arena),
      bossLine,
    ];
  }

  /** Test or admin spawn. Does not reset the 30 minute cycle. */
  manualSpawn(): { ok: true; message: string } | { ok: false; message: string } {
    if (this.host.findBoss()) return { ok: false, message: 'Мега-зомби уже на арене.' };
    const spawned = this.trySpawn(true);
    return spawned.ok
      ? { ok: true, message: spawned.message }
      : { ok: false, message: spawned.message };
  }

  onBossKilled(attackerName: string | null): void {
    this.rewardPending = true;
    if (attackerName) this.host.broadcast(megaZombieKillText(attackerName));
  }

  onBossRemoved(reason: 'death' | 'other', position: ArenaPoint): void {
    if (reason === 'death' && this.rewardPending) {
      this.rewardPending = false;
      this.host.dropLoot(position.x, position.y, position.z);
      this.host.launchFireworks(position.x, position.y, position.z);
      return;
    }
    this.rewardPending = false;
  }

  tick(dt: number): void {
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, MEGA_ZOMBIE_CYCLE_SECONDS);
    this.state.cycleSeconds += step;
    const warnAt = MEGA_ZOMBIE_CYCLE_SECONDS - MEGA_ZOMBIE_WARNING_LEAD_SECONDS;
    if (!this.state.warned && this.state.cycleSeconds >= warnAt) {
      this.state.warned = true;
      this.host.broadcast(MEGA_ZOMBIE_WARNING_TEXT);
      this.persist();
    }
    const boss = this.host.findBoss();
    if (boss?.alive && !boss.dying && boss.ageSeconds >= MEGA_ZOMBIE_LIFETIME_SECONDS) {
      this.rewardPending = false;
      this.host.despawnBoss();
      this.host.broadcast(MEGA_ZOMBIE_TIMEOUT_TEXT);
    }
    if (this.state.cycleSeconds >= MEGA_ZOMBIE_CYCLE_SECONDS) {
      const current = this.host.findBoss();
      if (current?.dying) return;
      if (current?.alive) {
        this.rewardPending = false;
        this.host.despawnBoss();
        this.host.broadcast(MEGA_ZOMBIE_TIMEOUT_TEXT);
      }
      this.state.cycleSeconds = 0;
      this.state.warned = false;
      this.trySpawn(true);
      this.persist();
      return;
    }
    this.saveAccumulator += step;
    if (this.saveAccumulator >= 30) {
      this.saveAccumulator = 0;
      this.persist();
    }
  }

  private trySpawn(announce: boolean): { ok: boolean; message: string } {
    const arena = this.arena();
    const spawn = this.state.spawn;
    if (!arena || !spawn) {
      const message = 'Арена не настроена. /boss setspawn, /boss setpos1, /boss setpos2';
      this.host.log(message);
      return { ok: false, message };
    }
    if (!this.insideWorld(spawn)) {
      const message = 'Точка появления вне мира.';
      this.host.log(message);
      return { ok: false, message };
    }
    if (this.host.findBoss()) return { ok: false, message: 'Мега-зомби уже на арене.' };
    const spawned = this.host.spawnBoss(spawn, arena);
    if (!spawned) {
      const message = 'Не удалось создать Мега-зомби.';
      this.host.log(message);
      return { ok: false, message };
    }
    if (announce) this.host.broadcast(MEGA_ZOMBIE_SPAWN_TEXT);
    return { ok: true, message: MEGA_ZOMBIE_SPAWN_TEXT };
  }

  private insideWorld(point: ArenaPoint): boolean {
    return point.y >= 0 && point.y < WORLD_HEIGHT;
  }

  private persist(): void {
    this.host.save(this.persisted);
  }
}

export function bossLootStacks(random: () => number) {
  return rollMegaZombieLoot(random);
}
