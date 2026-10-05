import { randomUUID } from 'node:crypto';
import { isValidWorldY } from '../../src/core/constants';
import { isPlayerCenterInsidePlayableWorld } from '../../src/world/worldBorder';
import {
  DUEL_ARENA_BUSY,
  DUEL_ARENA_UNCONFIGURED,
  DUEL_COUNTDOWN_MS,
  DUEL_CROSS_INVITE,
  DUEL_FIGHT_BANNER_MS,
  DUEL_INVITE_TTL_MS,
  DUEL_LOOT_WINDOW_MS,
  DUEL_MATCH_DURATION_MS,
  DUEL_NEARBY_RADIUS,
  DUEL_POST_MATCH_COOLDOWN_MS,
  DUEL_REJECT_COOLDOWN_MS,
  DUEL_STARTED,
  DUEL_TELEPORT_DENIED,
  DUEL_TOO_FAR,
  duelBlockDistance,
  duelChallengeMessage,
  duelCooldownMessage,
  duelCountdownGlyph,
  duelExpiredMessage,
  duelHologramPosition,
  duelRejectedMessage,
  withinDuelRange,
  type DuelIncomingRow,
  type DuelMenuView,
  type DuelNearbyRow,
  type DuelOutgoingRow,
  type DuelPlayerStats,
  type DuelPose,
} from '../../shared/duels';

export interface DuelActor {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  readonly gamemode: string;
  readonly alive: boolean;
  readonly worldId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface DuelDirectory {
  get(id: string): DuelActor | undefined;
  list(): readonly DuelActor[];
}

export interface DuelStore {
  loadStats(): unknown;
  saveStats(value: unknown): void;
  loadArena(): unknown;
  saveArena(value: unknown): void;
}

/** Trusted world operations. Not part of the public plugin API. */
export interface DuelRuntime {
  preparePlayer(playerId: string): boolean;
  hardRelocateForDuel(playerId: string, pose: DuelPose): boolean;
  restorePreDuelPose(playerId: string, pose: DuelPose): boolean;
  dropAllResources(playerId: string): readonly string[];
  removeDroppedItems(ids: readonly string[]): void;
  respawnAtWorldSpawn(playerId: string): boolean;
  relocateToWorldSpawn(playerId: string): boolean;
  closeTransientUi(playerId: string): void;
  refreshGameMenu(playerId: string): void;
  sendMessage(playerId: string, text: string): void;
  notifyDuels(playerId: string): void;
  capturePose(playerId: string): DuelPose | undefined;
  worldSpawnPose(): DuelPose;
  setCountdownHologram(text: string, x: number, y: number, z: number): void;
  clearCountdownHologram(): void;
}

export interface DuelDeps {
  worldId: string;
  store: DuelStore;
  directory: DuelDirectory;
  runtime: DuelRuntime;
  now?: () => number;
}

export interface DuelActionResult {
  readonly ok: boolean;
  readonly message?: string;
}

interface DuelInvite {
  readonly requestId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface CountdownPhase {
  readonly kind: 'countdown';
  readonly matchId: string;
  readonly players: readonly [string, string];
  readonly poses: Readonly<Record<string, DuelPose>>;
  readonly startedAt: number;
  shown: '3' | '2' | '1';
}

interface FightingPhase {
  readonly kind: 'fighting';
  readonly matchId: string;
  readonly players: readonly [string, string];
  readonly poses: Readonly<Record<string, DuelPose>>;
  readonly fightStartedAt: number;
  readonly deadline: number;
  bannerUntil: number;
  bannerCleared: boolean;
}

interface LootPhase {
  readonly kind: 'loot';
  readonly matchId: string;
  readonly winnerId: string;
  readonly loserId: string;
  readonly dropIds: string[];
  readonly cleanupAt: number;
}

interface TimeoutPhase {
  readonly kind: 'timeout_cleanup';
  readonly matchId: string;
  readonly players: readonly [string, string];
  readonly dropIds: string[];
  readonly cleanupAt: number;
}

type DuelPhase = { kind: 'idle' } | CountdownPhase | FightingPhase | LootPhase | TimeoutPhase;

interface ArenaConfig {
  spawn1?: DuelPose;
  spawn2?: DuelPose;
}

const EMPTY_STATS = (): DuelPlayerStats => ({
  wins: 0,
  losses: 0,
  displayName: '',
  opponents: {},
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePose(raw: unknown, fallbackWorld: string): DuelPose | undefined {
  if (!isRecord(raw)) return undefined;
  const x = finite(raw.x);
  const y = finite(raw.y);
  const z = finite(raw.z);
  const yaw = finite(raw.yaw) ?? 0;
  const pitch = finite(raw.pitch) ?? 0;
  if (x === undefined || y === undefined || z === undefined) return undefined;
  if (!isValidWorldY(Math.floor(y)) || !isPlayerCenterInsidePlayableWorld(x, z)) return undefined;
  const worldId = typeof raw.worldId === 'string' && raw.worldId.length > 0 ? raw.worldId : fallbackWorld;
  return { worldId, x, y, z, yaw, pitch };
}

function parseStats(raw: unknown): Record<string, DuelPlayerStats> {
  const players: Record<string, DuelPlayerStats> = {};
  if (!isRecord(raw) || !isRecord(raw.players)) return players;
  for (const [id, entry] of Object.entries(raw.players)) {
    if (!id || !isRecord(entry)) continue;
    const stats = EMPTY_STATS();
    stats.wins = nonNegativeInt(entry.wins);
    stats.losses = nonNegativeInt(entry.losses);
    stats.displayName = typeof entry.displayName === 'string' ? entry.displayName.slice(0, 32) : '';
    if (isRecord(entry.opponents)) {
      for (const [opponentId, opponent] of Object.entries(entry.opponents)) {
        if (!opponentId || !isRecord(opponent)) continue;
        stats.opponents[opponentId] = {
          wins: nonNegativeInt(opponent.wins),
          losses: nonNegativeInt(opponent.losses),
          displayName: typeof opponent.displayName === 'string' ? opponent.displayName.slice(0, 32) : '',
        };
      }
    }
    players[id] = stats;
  }
  return players;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}\0${toId}`;
}

export class DuelService {
  private nowFn: () => number;
  private readonly statsPlayers: Record<string, DuelPlayerStats>;
  private arena: ArenaConfig;
  private readonly invites = new Map<string, DuelInvite>();
  private readonly rejectUntil = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private phase: DuelPhase = { kind: 'idle' };
  private readonly committed = new Set<string>();
  private shownHologram: string | undefined;

  constructor(private readonly deps: DuelDeps) {
    this.nowFn = deps.now ?? (() => Date.now());
    this.statsPlayers = parseStats(deps.store.loadStats());
    const loaded = deps.store.loadArena();
    const record = isRecord(loaded) ? loaded : {};
    this.arena = {
      spawn1: parsePose(record.spawn1, deps.worldId),
      spawn2: parsePose(record.spawn2, deps.worldId),
    };
  }

  setNow(now: () => number): void {
    this.nowFn = now;
  }

  now(): number {
    return this.nowFn();
  }

  phaseKind(): DuelPhase['kind'] {
    return this.phase.kind;
  }

  activeMatchId(): string | undefined {
    return this.phase.kind === 'idle' ? undefined : this.phase.matchId;
  }

  shownCountdownText(): string | undefined {
    return this.shownHologram;
  }

  fightDeadline(): number | undefined {
    return this.phase.kind === 'fighting' ? this.phase.deadline : undefined;
  }

  trackedDropIds(): readonly string[] {
    if (this.phase.kind === 'loot' || this.phase.kind === 'timeout_cleanup') return this.phase.dropIds;
    return [];
  }

  configured(): boolean {
    return Boolean(this.arena.spawn1 && this.arena.spawn2);
  }

  busy(): boolean {
    return this.phase.kind !== 'idle';
  }

  arenaInfo(): {
    configured: boolean;
    busy: boolean;
    phase: DuelPhase['kind'];
    spawn1?: DuelPose;
    spawn2?: DuelPose;
  } {
    return {
      configured: this.configured(),
      busy: this.busy(),
      phase: this.phase.kind,
      ...(this.arena.spawn1 ? { spawn1: { ...this.arena.spawn1 } } : {}),
      ...(this.arena.spawn2 ? { spawn2: { ...this.arena.spawn2 } } : {}),
    };
  }

  setSpawn(index: 1 | 2, pose: DuelPose): DuelActionResult {
    const parsed = parsePose(pose, this.deps.worldId);
    if (!parsed) return { ok: false, message: 'Некорректная позиция спавна.' };
    if (index === 1) this.arena.spawn1 = parsed;
    else this.arena.spawn2 = parsed;
    this.deps.store.saveArena({
      ...(this.arena.spawn1 ? { spawn1: this.arena.spawn1 } : {}),
      ...(this.arena.spawn2 ? { spawn2: this.arena.spawn2 } : {}),
    });
    return { ok: true, message: `Точка ${index} сохранена.` };
  }

  statsOf(playerId: string): { wins: number; losses: number; displayName: string } {
    const stats = this.statsPlayers[playerId];
    if (!stats) return { wins: 0, losses: 0, displayName: '' };
    return { wins: stats.wins, losses: stats.losses, displayName: stats.displayName };
  }

  headToHead(playerId: string, opponentId: string): { wins: number; losses: number } {
    const row = this.statsPlayers[playerId]?.opponents[opponentId];
    return { wins: row?.wins ?? 0, losses: row?.losses ?? 0 };
  }

  noteIdentity(playerId: string, name: string): void {
    if (!playerId || !name) return;
    let changed = false;
    const self = this.statsPlayers[playerId];
    if (self && self.displayName !== name) {
      self.displayName = name;
      changed = true;
    }
    for (const stats of Object.values(this.statsPlayers)) {
      const opponent = stats.opponents[playerId];
      if (opponent && opponent.displayName !== name) {
        opponent.displayName = name;
        changed = true;
      }
    }
    if (changed) this.persistStats();
  }

  cooldownRemaining(playerId: string, now = this.now()): number {
    return Math.max(0, (this.cooldownUntil.get(playerId) ?? 0) - now);
  }

  menu(playerId: string): DuelMenuView {
    const now = this.now();
    this.expireInvites(now);
    this.noteLiveNames();
    const self = this.deps.directory.get(playerId);
    if (self) this.noteIdentity(self.id, self.name);
    const stats = this.statsOf(playerId);
    const cooldownMs = this.cooldownRemaining(playerId, now);
    const outgoingInvite = [...this.invites.values()].find((invite) => invite.fromId === playerId);
    const outgoing = outgoingInvite ? this.outgoingView(outgoingInvite, now) : undefined;
    const incoming = [...this.invites.values()]
      .filter((invite) => invite.toId === playerId && invite.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId))
      .map((invite) => this.incomingView(playerId, invite));
    return {
      stats: { wins: stats.wins, losses: stats.losses },
      arenaConfigured: this.configured(),
      arenaBusy: this.busy(),
      cooldownMs,
      incoming,
      ...(outgoing ? { outgoing } : {}),
      nearby: this.nearbyRows(playerId, now),
    };
  }

  challenge(fromId: string, targetId: string): DuelActionResult {
    const now = this.now();
    this.expireInvites(now);
    const from = this.deps.directory.get(fromId);
    const target = this.deps.directory.get(targetId);
    if (!from || !target) return { ok: false, message: 'Игрок недоступен.' };
    if (from.id === target.id) return { ok: false, message: 'Нельзя вызвать самого себя.' };
    const fromCheck = this.validateReady(from, now);
    if (!fromCheck.ok) return fromCheck;
    const targetCheck = this.validateReady(target, now, { ignoreCooldown: true });
    if (!targetCheck.ok) return targetCheck;
    if (!this.configured()) return { ok: false, message: DUEL_ARENA_UNCONFIGURED };
    if ([...this.invites.values()].some((invite) => invite.fromId === from.id)) {
      return { ok: false, message: 'У вас уже есть исходящий вызов.' };
    }
    if ([...this.invites.values()].some((invite) => invite.fromId === target.id && invite.toId === from.id)) {
      return { ok: false, message: DUEL_CROSS_INVITE };
    }
    if (!this.sameWorld(from, target) || !withinDuelRange(from, target)) {
      return { ok: false, message: DUEL_TOO_FAR };
    }
    if ((this.rejectUntil.get(pairKey(from.id, target.id)) ?? 0) > now) {
      return { ok: false, message: 'Этот игрок недавно отклонил вызов.' };
    }
    this.noteIdentity(from.id, from.name);
    this.noteIdentity(target.id, target.name);
    const invite: DuelInvite = {
      requestId: randomUUID(),
      fromId: from.id,
      toId: target.id,
      createdAt: now,
      expiresAt: now + DUEL_INVITE_TTL_MS,
    };
    this.invites.set(invite.requestId, invite);
    this.deps.runtime.sendMessage(target.id, duelChallengeMessage(from.name));
    this.deps.runtime.notifyDuels(target.id);
    this.deps.runtime.refreshGameMenu(from.id);
    this.deps.runtime.refreshGameMenu(target.id);
    return { ok: true };
  }

  accept(playerId: string, requestId: string): DuelActionResult {
    const now = this.now();
    this.expireInvites(now);
    const invite = this.invites.get(requestId);
    if (!invite || invite.toId !== playerId) return { ok: false, message: 'Вызов не найден.' };
    if (invite.expiresAt <= now) {
      this.expireInvite(invite, now);
      return { ok: false, message: 'Вызов истёк.' };
    }
    const from = this.deps.directory.get(invite.fromId);
    const to = this.deps.directory.get(invite.toId);
    if (!from?.connected || !to?.connected) return { ok: false, message: 'Игрок недоступен.' };
    const fromCheck = this.validateReady(from, now);
    if (!fromCheck.ok) return fromCheck;
    const toCheck = this.validateReady(to, now);
    if (!toCheck.ok) return toCheck;
    if (!this.configured() || !this.arena.spawn1 || !this.arena.spawn2) {
      return { ok: false, message: DUEL_ARENA_UNCONFIGURED };
    }
    if (this.busy()) return { ok: false, message: DUEL_ARENA_BUSY };
    if (!this.sameWorld(from, to) || !withinDuelRange(from, to)) {
      this.invites.delete(invite.requestId);
      this.deps.runtime.refreshGameMenu(from.id);
      this.deps.runtime.refreshGameMenu(to.id);
      return { ok: false, message: DUEL_TOO_FAR };
    }
    const poseA = this.deps.runtime.capturePose(from.id);
    const poseB = this.deps.runtime.capturePose(to.id);
    if (!poseA || !poseB) return { ok: false, message: 'Игрок недоступен.' };
    this.clearInvitesInvolving(from.id, to.id);
    this.deps.runtime.closeTransientUi(from.id);
    this.deps.runtime.closeTransientUi(to.id);
    if (!this.deps.runtime.preparePlayer(from.id) || !this.deps.runtime.preparePlayer(to.id)) {
      return { ok: false, message: 'Не удалось подготовить игроков.' };
    }
    const movedA = this.deps.runtime.hardRelocateForDuel(from.id, this.arena.spawn1);
    const movedB = this.deps.runtime.hardRelocateForDuel(to.id, this.arena.spawn2);
    if (!movedA || !movedB) {
      if (movedA) this.deps.runtime.restorePreDuelPose(from.id, poseA);
      if (movedB) this.deps.runtime.restorePreDuelPose(to.id, poseB);
      return { ok: false, message: 'Не удалось переместить игроков на арену.' };
    }
    const matchId = randomUUID();
    this.phase = {
      kind: 'countdown',
      matchId,
      players: [from.id, to.id],
      poses: { [from.id]: poseA, [to.id]: poseB },
      startedAt: now,
      shown: '3',
    };
    this.syncCountdownHologram(0);
    this.deps.runtime.refreshGameMenu(from.id);
    this.deps.runtime.refreshGameMenu(to.id);
    return { ok: true };
  }

  decline(playerId: string, requestId: string): DuelActionResult {
    const now = this.now();
    const invite = this.invites.get(requestId);
    if (!invite || invite.toId !== playerId) return { ok: false, message: 'Вызов не найден.' };
    this.invites.delete(invite.requestId);
    this.rejectUntil.set(pairKey(invite.fromId, invite.toId), now + DUEL_REJECT_COOLDOWN_MS);
    const target = this.deps.directory.get(invite.toId);
    this.deps.runtime.sendMessage(invite.fromId, duelRejectedMessage(target?.name ?? 'Игрок'));
    this.deps.runtime.refreshGameMenu(invite.fromId);
    this.deps.runtime.refreshGameMenu(invite.toId);
    return { ok: true };
  }

  tick(): void {
    const now = this.now();
    this.expireInvites(now);
    if (this.phase.kind === 'countdown') {
      const elapsed = now - this.phase.startedAt;
      if (elapsed >= DUEL_COUNTDOWN_MS) this.enterFighting(this.phase);
      else {
        this.syncCountdownHologram(elapsed);
        return;
      }
    }
    if (this.phase.kind === 'fighting') {
      if (!this.phase.bannerCleared && now >= this.phase.bannerUntil) {
        this.phase.bannerCleared = true;
        this.clearHologram();
      }
      if (now >= this.phase.deadline) this.timeoutMatch(this.phase, now);
      return;
    }
    if ((this.phase.kind === 'loot' || this.phase.kind === 'timeout_cleanup') && now >= this.phase.cleanupAt) {
      this.finishCleanup(now);
    }
  }

  onPlayerQuit(playerId: string): void {
    const phase = this.phase;
    if (phase.kind === 'countdown' && phase.players.includes(playerId)) {
      this.cancelMatch(phase.matchId, phase.players, phase.poses);
      return;
    }
    if (phase.kind === 'fighting' && phase.players.includes(playerId)) {
      const opponent = phase.players[0] === playerId ? phase.players[1] : phase.players[0];
      this.forfeit(phase, playerId, opponent);
      return;
    }
    if (phase.kind === 'loot' && phase.winnerId === playerId) {
      this.deps.runtime.relocateToWorldSpawn(playerId);
      return;
    }
    if (phase.kind === 'timeout_cleanup' && phase.players.includes(playerId)) {
      this.deps.runtime.relocateToWorldSpawn(playerId);
    }
  }

  /**
   * Called after the shared death-drop helper has already spawned loot.
   * Does not drop again.
   */
  finalizeDeath(playerId: string, dropIds: readonly string[]): void {
    const phase = this.phase;
    if (phase.kind !== 'fighting' || !phase.players.includes(playerId)) return;
    if (this.committed.has(phase.matchId)) return;
    const loserId = playerId;
    const winnerId = phase.players[0] === loserId ? phase.players[1] : phase.players[0];
    if (!this.commitOnce(phase.matchId)) return;
    this.recordWin(winnerId, loserId);
    this.armCooldown(winnerId, loserId);
    this.deps.runtime.respawnAtWorldSpawn(loserId);
    this.deps.runtime.sendMessage(winnerId, 'Вы победили в дуэли.');
    this.deps.runtime.sendMessage(loserId, 'Вы проиграли дуэль.');
    this.phase = {
      kind: 'loot',
      matchId: phase.matchId,
      winnerId,
      loserId,
      dropIds: [...dropIds],
      cleanupAt: this.now() + DUEL_LOOT_WINDOW_MS,
    };
    this.clearHologram();
    this.deps.runtime.refreshGameMenu(winnerId);
    this.deps.runtime.refreshGameMenu(loserId);
  }

  shutdown(): void {
    const phase = this.phase;
    if (phase.kind === 'countdown' || phase.kind === 'fighting') {
      this.cancelMatch(phase.matchId, phase.players, phase.poses);
      return;
    }
    if (phase.kind === 'loot') {
      this.deps.runtime.removeDroppedItems(phase.dropIds);
      this.deps.runtime.relocateToWorldSpawn(phase.winnerId);
      this.phase = { kind: 'idle' };
      this.clearHologram();
      return;
    }
    if (phase.kind === 'timeout_cleanup') {
      this.deps.runtime.removeDroppedItems(phase.dropIds);
      for (const id of phase.players) this.deps.runtime.relocateToWorldSpawn(id);
      this.phase = { kind: 'idle' };
      this.clearHologram();
    }
  }

  blocksManualDrop(playerId: string): boolean {
    const phase = this.phase;
    return (phase.kind === 'countdown' || phase.kind === 'fighting') && phase.players.includes(playerId);
  }

  blocksCombatIntent(playerId: string, _kind: 'melee' | 'projectile'): boolean {
    const phase = this.phase;
    return phase.kind === 'countdown' && phase.players.includes(playerId);
  }

  shouldCancelPlayerDamage(victimId: string, attackerId?: string): boolean {
    const phase = this.phase;
    if (phase.kind === 'countdown' && phase.players.includes(victimId)) return true;
    if (phase.kind !== 'fighting') return false;
    const [a, b] = phase.players;
    const victimIn = victimId === a || victimId === b;
    const attackerIn = attackerId === a || attackerId === b;
    if (!victimIn && !attackerIn) return false;
    if (!attackerId) return false;
    if (victimIn && attackerId !== (victimId === a ? b : a)) return true;
    if (attackerIn && victimId !== (attackerId === a ? b : a)) return true;
    return false;
  }

  shouldSuppressNormalPvpSettlement(victimId: string, attackerId: string): boolean {
    const phase = this.phase;
    if (phase.kind !== 'fighting') return false;
    const [a, b] = phase.players;
    return (victimId === a && attackerId === b) || (victimId === b && attackerId === a);
  }

  externalTeleportError(playerId: string): string | undefined {
    return this.isTeleportLocked(playerId) ? DUEL_TELEPORT_DENIED : undefined;
  }

  movementLock(playerId: string): DuelPose | undefined {
    const phase = this.phase;
    if (phase.kind !== 'countdown' || !phase.players.includes(playerId)) return undefined;
    if (!this.arena.spawn1 || !this.arena.spawn2) return undefined;
    return playerId === phase.players[0] ? this.arena.spawn1 : this.arena.spawn2;
  }

  allowsPickup(playerId: string, entityId: string): boolean {
    const phase = this.phase;
    if (phase.kind === 'loot') {
      if (!phase.dropIds.includes(entityId)) return true;
      return playerId === phase.winnerId;
    }
    if (phase.kind === 'timeout_cleanup') {
      if (!phase.dropIds.includes(entityId)) return true;
      return false;
    }
    return true;
  }

  private nearbyRows(playerId: string, now: number): DuelNearbyRow[] {
    const self = this.deps.directory.get(playerId);
    if (!self?.connected) return [];
    const viewerReady = this.validateReady(self, now).ok;
    const challengeLocked = this.challengeLocked(playerId, now);
    const rows: DuelNearbyRow[] = [];
    for (const actor of this.deps.directory.list()) {
      if (actor.id === playerId || !actor.connected || actor.gamemode !== 'survival' || !actor.alive) continue;
      if (!this.sameWorld(self, actor) || !withinDuelRange(self, actor)) continue;
      if (this.isInLifecycle(actor.id)) continue;
      const score = this.headToHead(playerId, actor.id);
      rows.push({
        playerId: actor.id,
        name: actor.name,
        wins: score.wins,
        losses: score.losses,
        distance: duelBlockDistance(self, actor),
        canChallenge: viewerReady
          && challengeLocked === undefined
          && this.configured()
          && this.validateReady(actor, now, { ignoreCooldown: true }).ok,
      });
    }
    rows.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'ru') || a.playerId.localeCompare(b.playerId));
    return rows;
  }

  private challengeLocked(playerId: string, now: number): string | undefined {
    if ([...this.invites.values()].some((invite) => invite.fromId === playerId && invite.expiresAt > now)) {
      return 'outgoing';
    }
    if (this.cooldownRemaining(playerId, now) > 0) return 'cooldown';
    if (!this.configured()) return 'arena';
    return undefined;
  }

  private incomingView(viewerId: string, invite: DuelInvite): DuelIncomingRow {
    const from = this.deps.directory.get(invite.fromId);
    const score = this.headToHead(viewerId, invite.fromId);
    return {
      requestId: invite.requestId,
      playerId: invite.fromId,
      name: from?.name || this.statsOf(invite.fromId).displayName || invite.fromId.slice(0, 8),
      wins: score.wins,
      losses: score.losses,
    };
  }

  private outgoingView(invite: DuelInvite, now: number): DuelOutgoingRow {
    const target = this.deps.directory.get(invite.toId);
    return {
      playerId: invite.toId,
      name: target?.name || this.statsOf(invite.toId).displayName || invite.toId.slice(0, 8),
      secondsLeft: Math.max(0, Math.ceil((invite.expiresAt - now) / 1000)),
    };
  }

  private validateReady(
    actor: DuelActor,
    now: number,
    options: { ignoreCooldown?: boolean } = {},
  ): DuelActionResult {
    if (!actor.connected) return { ok: false, message: 'Игрок недоступен.' };
    if (actor.gamemode !== 'survival') return { ok: false, message: 'Дуэль доступна только в режиме выживания.' };
    if (!actor.alive) return { ok: false, message: 'Игрок мёртв.' };
    if (this.isInLifecycle(actor.id)) return { ok: false, message: 'Игрок уже участвует в дуэли.' };
    if (!options.ignoreCooldown && this.cooldownRemaining(actor.id, now) > 0) {
      return { ok: false, message: duelCooldownMessage(this.cooldownRemaining(actor.id, now)) };
    }
    return { ok: true };
  }

  private sameWorld(a: DuelActor, b: DuelActor): boolean {
    return a.worldId === b.worldId && a.worldId === this.deps.worldId;
  }

  private isInLifecycle(playerId: string): boolean {
    const phase = this.phase;
    if (phase.kind === 'countdown' || phase.kind === 'fighting' || phase.kind === 'timeout_cleanup') {
      return phase.players.includes(playerId);
    }
    if (phase.kind === 'loot') return playerId === phase.winnerId;
    return false;
  }

  private isTeleportLocked(playerId: string): boolean {
    const phase = this.phase;
    if (phase.kind === 'countdown' || phase.kind === 'fighting') return phase.players.includes(playerId);
    if (phase.kind === 'loot') return playerId === phase.winnerId;
    return false;
  }

  private enterFighting(phase: CountdownPhase): void {
    const fightStartedAt = phase.startedAt + DUEL_COUNTDOWN_MS;
    const now = this.now();
    this.phase = {
      kind: 'fighting',
      matchId: phase.matchId,
      players: phase.players,
      poses: phase.poses,
      fightStartedAt,
      deadline: fightStartedAt + DUEL_MATCH_DURATION_MS,
      bannerUntil: now + DUEL_FIGHT_BANNER_MS,
      bannerCleared: false,
    };
    this.showHologram('БОЙ!');
    for (const id of phase.players) this.deps.runtime.sendMessage(id, DUEL_STARTED);
  }

  private syncCountdownHologram(elapsedMs: number): void {
    const glyph = duelCountdownGlyph(elapsedMs);
    if (glyph === 'fight') return;
    const phase = this.phase;
    if (phase.kind === 'countdown' && phase.shown === glyph && this.shownHologram === glyph) return;
    if (phase.kind === 'countdown') phase.shown = glyph;
    this.showHologram(glyph);
  }

  private showHologram(text: string): void {
    if (!this.arena.spawn1 || !this.arena.spawn2) return;
    if (this.shownHologram === text) return;
    const at = duelHologramPosition(this.arena.spawn1, this.arena.spawn2);
    this.deps.runtime.setCountdownHologram(text, at.x, at.y, at.z);
    this.shownHologram = text;
  }

  private clearHologram(): void {
    if (!this.shownHologram) {
      this.deps.runtime.clearCountdownHologram();
      return;
    }
    this.shownHologram = undefined;
    this.deps.runtime.clearCountdownHologram();
  }

  private forfeit(phase: FightingPhase, quitterId: string, winnerId: string): void {
    if (!this.commitOnce(phase.matchId)) return;
    const dropIds = this.deps.runtime.dropAllResources(quitterId);
    this.deps.runtime.relocateToWorldSpawn(quitterId);
    this.recordWin(winnerId, quitterId);
    this.armCooldown(winnerId, quitterId);
    this.deps.runtime.sendMessage(winnerId, 'Соперник вышел. Победа за вами.');
    this.phase = {
      kind: 'loot',
      matchId: phase.matchId,
      winnerId,
      loserId: quitterId,
      dropIds: [...dropIds],
      cleanupAt: this.now() + DUEL_LOOT_WINDOW_MS,
    };
    this.clearHologram();
    this.deps.runtime.refreshGameMenu(winnerId);
  }

  private timeoutMatch(phase: FightingPhase, now: number): void {
    if (!this.commitOnce(phase.matchId)) return;
    const [a, b] = phase.players;
    const dropsA = this.deps.runtime.dropAllResources(a);
    const dropsB = this.deps.runtime.dropAllResources(b);
    this.deps.runtime.relocateToWorldSpawn(a);
    this.deps.runtime.relocateToWorldSpawn(b);
    this.recordTimeout(a, b);
    this.armCooldown(a, b);
    this.deps.runtime.sendMessage(a, 'Время дуэли вышло. Оба игрока получают поражение.');
    this.deps.runtime.sendMessage(b, 'Время дуэли вышло. Оба игрока получают поражение.');
    this.phase = {
      kind: 'timeout_cleanup',
      matchId: phase.matchId,
      players: phase.players,
      dropIds: [...dropsA, ...dropsB],
      cleanupAt: now + DUEL_LOOT_WINDOW_MS,
    };
    this.clearHologram();
    this.deps.runtime.refreshGameMenu(a);
    this.deps.runtime.refreshGameMenu(b);
  }

  private cancelMatch(
    matchId: string,
    players: readonly [string, string],
    poses: Readonly<Record<string, DuelPose>>,
  ): void {
    if (!this.commitOnce(matchId)) return;
    for (const id of players) {
      const pose = poses[id];
      if (pose) this.deps.runtime.restorePreDuelPose(id, pose);
      this.deps.runtime.sendMessage(id, 'Дуэль отменена.');
      this.deps.runtime.refreshGameMenu(id);
    }
    this.phase = { kind: 'idle' };
    this.clearHologram();
  }

  private finishCleanup(_now: number): void {
    const phase = this.phase;
    if (phase.kind === 'loot') {
      this.deps.runtime.removeDroppedItems(phase.dropIds);
      this.deps.runtime.relocateToWorldSpawn(phase.winnerId);
      this.deps.runtime.refreshGameMenu(phase.winnerId);
      this.deps.runtime.refreshGameMenu(phase.loserId);
    } else if (phase.kind === 'timeout_cleanup') {
      this.deps.runtime.removeDroppedItems(phase.dropIds);
      for (const id of phase.players) this.deps.runtime.refreshGameMenu(id);
    }
    this.phase = { kind: 'idle' };
    this.clearHologram();
  }

  private expireInvites(now: number): void {
    for (const invite of [...this.invites.values()]) {
      if (invite.expiresAt > now) continue;
      this.expireInvite(invite, now);
    }
  }

  private expireInvite(invite: DuelInvite, _now: number): void {
    if (!this.invites.has(invite.requestId)) return;
    this.invites.delete(invite.requestId);
    const target = this.deps.directory.get(invite.toId);
    this.deps.runtime.sendMessage(invite.fromId, duelExpiredMessage(target?.name || this.statsOf(invite.toId).displayName || 'игроку'));
    this.deps.runtime.refreshGameMenu(invite.fromId);
    this.deps.runtime.refreshGameMenu(invite.toId);
  }

  private clearInvitesInvolving(...playerIds: string[]): void {
    const ids = new Set(playerIds);
    const touched = new Set<string>();
    for (const invite of [...this.invites.values()]) {
      if (!ids.has(invite.fromId) && !ids.has(invite.toId)) continue;
      this.invites.delete(invite.requestId);
      touched.add(invite.fromId);
      touched.add(invite.toId);
    }
    for (const id of touched) this.deps.runtime.refreshGameMenu(id);
  }

  private commitOnce(matchId: string): boolean {
    if (this.committed.has(matchId)) return false;
    this.committed.add(matchId);
    return true;
  }

  private recordWin(winnerId: string, loserId: string): void {
    const winner = this.ensure(winnerId);
    const loser = this.ensure(loserId);
    winner.wins += 1;
    loser.losses += 1;
    const winnerRow = this.ensureOpponent(winner, loserId, loser.displayName);
    const loserRow = this.ensureOpponent(loser, winnerId, winner.displayName);
    winnerRow.wins += 1;
    loserRow.losses += 1;
    this.persistStats();
  }

  private recordTimeout(a: string, b: string): void {
    const left = this.ensure(a);
    const right = this.ensure(b);
    left.losses += 1;
    right.losses += 1;
    this.ensureOpponent(left, b, right.displayName).losses += 1;
    this.ensureOpponent(right, a, left.displayName).losses += 1;
    this.persistStats();
  }

  private armCooldown(...playerIds: string[]): void {
    const until = this.now() + DUEL_POST_MATCH_COOLDOWN_MS;
    for (const id of playerIds) this.cooldownUntil.set(id, until);
  }

  private ensure(playerId: string): DuelPlayerStats {
    const existing = this.statsPlayers[playerId];
    if (existing) {
      const live = this.deps.directory.get(playerId);
      if (live?.name) existing.displayName = live.name;
      return existing;
    }
    const created = EMPTY_STATS();
    created.displayName = this.deps.directory.get(playerId)?.name ?? '';
    this.statsPlayers[playerId] = created;
    return created;
  }

  private ensureOpponent(stats: DuelPlayerStats, opponentId: string, displayName: string): DuelPlayerStats['opponents'][string] {
    const existing = stats.opponents[opponentId];
    if (existing) {
      if (displayName) existing.displayName = displayName;
      return existing;
    }
    const created = { wins: 0, losses: 0, displayName };
    stats.opponents[opponentId] = created;
    return created;
  }

  private noteLiveNames(): void {
    for (const actor of this.deps.directory.list()) this.noteIdentity(actor.id, actor.name);
  }

  private persistStats(): void {
    this.deps.store.saveStats({ players: this.statsPlayers });
  }
}

export function duelMenuMessage(view: DuelMenuView): string | undefined {
  if (!view.arenaConfigured) return DUEL_ARENA_UNCONFIGURED;
  if (view.cooldownMs > 0) return duelCooldownMessage(view.cooldownMs);
  return undefined;
}
