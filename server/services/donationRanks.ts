import type { JsonFileStore } from './jsonStore';
import { serverLog } from '../log';
import {
  DONATION_DAY_MS,
  DONATION_RANK_DURATION_MS,
  DONATION_RANKS,
  NICK_COLOR_IDS,
  RANK_LIMITS,
  RANK_ORDER,
  donationNodesAreNonAdmin,
  formatDurationMs,
  isDonationRank,
  isNickColorId,
  kitAccessRule,
  kitsForRank,
  permissionNodesForRank,
  playerNameStyle,
  slidingUse,
  type DonationCommandInfo,
  type DonationKitInfo,
  type DonationRankId,
  type DonationStatus,
  type EffectiveRank,
  type KitAccessRule,
  type LimitKind,
  type NickColorId,
  type PlayerNameStyle,
} from '../../shared/donationRanks';

const STORE_NAME = 'donation/ranks';
const HISTORY_LIMIT = 24;

export type RankChangeAction = 'grant' | 'extend' | 'replace' | 'revoke';

export interface RankHistoryEntry {
  at: number;
  action: RankChangeAction;
  rank: DonationRankId | 'default';
  expiresAt?: number;
  source?: string;
}

export interface RankGrant {
  rank: DonationRankId;
  grantedAt: number;
  expiresAt: number;
  source?: string;
  history: RankHistoryEntry[];
}

interface CooldownLedger {
  kits: Record<string, number>;
  announce: number[];
  deathBack: number[];
  coords: number[];
  invsee: number[];
}

interface DonationStore {
  grants: Record<string, RankGrant>;
  nickColors: Record<string, NickColorId>;
  cooldowns: Record<string, CooldownLedger>;
}

export type CooldownChannel = 'announce' | 'deathBack' | 'coords' | 'invsee' | `kit:${string}`;

export interface RankMutation {
  readonly ok: boolean;
  readonly error?: string;
  readonly rank?: EffectiveRank;
  readonly expiresAt?: number;
}

function emptyLedger(): CooldownLedger {
  return { kits: {}, announce: [], deathBack: [], coords: [], invsee: [] };
}

function emptyStore(): DonationStore {
  return { grants: {}, nickColors: {}, cooldowns: {} };
}

function cloneStore(store: DonationStore): DonationStore {
  return {
    grants: Object.fromEntries(Object.entries(store.grants).map(([key, grant]) => [key, {
      ...grant,
      history: grant.history.map((entry) => ({ ...entry })),
    }])),
    nickColors: { ...store.nickColors },
    cooldowns: Object.fromEntries(Object.entries(store.cooldowns).map(([key, ledger]) => [key, {
      kits: { ...ledger.kits },
      announce: [...ledger.announce],
      deathBack: [...ledger.deathBack],
      coords: [...ledger.coords],
      invsee: [...ledger.invsee],
    }])),
  };
}

function finiteTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseHistory(raw: unknown): RankHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RankHistoryEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as { at?: unknown; action?: unknown; rank?: unknown; expiresAt?: unknown; source?: unknown };
    const at = finiteTime(value.at);
    const action = value.action;
    if (at === undefined) continue;
    if (action !== 'grant' && action !== 'extend' && action !== 'replace' && action !== 'revoke') continue;
    const rank = value.rank === 'default' || (typeof value.rank === 'string' && isDonationRank(value.rank))
      ? value.rank
      : undefined;
    if (!rank) continue;
    const expiresAt = finiteTime(value.expiresAt);
    const source = typeof value.source === 'string' && value.source.length > 0 && value.source.length <= 64
      ? value.source
      : undefined;
    entries.push({
      at,
      action,
      rank,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(source ? { source } : {}),
    });
  }
  return entries.slice(-HISTORY_LIMIT);
}

function parseGrant(raw: unknown): RankGrant | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as { rank?: unknown; grantedAt?: unknown; expiresAt?: unknown; source?: unknown; history?: unknown };
  if (typeof value.rank !== 'string' || !isDonationRank(value.rank)) return undefined;
  const grantedAt = finiteTime(value.grantedAt);
  const expiresAt = finiteTime(value.expiresAt);
  if (grantedAt === undefined || expiresAt === undefined) return undefined;
  const source = typeof value.source === 'string' && value.source.length > 0 && value.source.length <= 64
    ? value.source
    : undefined;
  return {
    rank: value.rank,
    grantedAt,
    expiresAt,
    ...(source ? { source } : {}),
    history: parseHistory(value.history),
  };
}

function parseStamps(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)).slice(-32);
}

function parseLedger(raw: unknown): CooldownLedger {
  const ledger = emptyLedger();
  if (!raw || typeof raw !== 'object') return ledger;
  const value = raw as { kits?: unknown; announce?: unknown; deathBack?: unknown; coords?: unknown; invsee?: unknown };
  if (value.kits && typeof value.kits === 'object') {
    for (const [name, stamp] of Object.entries(value.kits)) {
      if (kitAccessRule(name) && typeof stamp === 'number' && Number.isFinite(stamp)) ledger.kits[name] = stamp;
    }
  }
  ledger.announce = parseStamps(value.announce);
  ledger.deathBack = parseStamps(value.deathBack);
  ledger.coords = parseStamps(value.coords);
  ledger.invsee = parseStamps(value.invsee);
  return ledger;
}

export function parseDonationStore(raw: unknown): DonationStore {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') return store;
  const value = raw as { grants?: unknown; nickColors?: unknown; cooldowns?: unknown };
  if (value.grants && typeof value.grants === 'object') {
    for (const [key, entry] of Object.entries(value.grants)) {
      if (!key || key.length > 80) continue;
      const grant = parseGrant(entry);
      if (grant) store.grants[key] = grant;
    }
  }
  if (value.nickColors && typeof value.nickColors === 'object') {
    for (const [key, color] of Object.entries(value.nickColors)) {
      if (typeof color === 'string' && isNickColorId(color)) store.nickColors[key] = color;
    }
  }
  if (value.cooldowns && typeof value.cooldowns === 'object') {
    for (const [key, entry] of Object.entries(value.cooldowns)) {
      if (!key || key.length > 80) continue;
      store.cooldowns[key] = parseLedger(entry);
    }
  }
  return store;
}

/**
 * One active donate rank per player, plus sliding cooldowns and a nick color.
 * Expired ranks stop granting nodes immediately, including after a restart.
 */
export class DonationRankService {
  private state: DonationStore = emptyStore();
  private readFailed = false;
  private readonly busy = new Set<string>();

  constructor(
    private readonly store: JsonFileStore,
    private readonly resolveKey: (playerIdOrName: string) => string = (value) => value.trim().toLowerCase(),
  ) {}

  load(): void {
    try {
      this.state = parseDonationStore(this.store.load<unknown>(STORE_NAME, emptyStore()));
      this.readFailed = false;
    } catch (error) {
      this.state = emptyStore();
      this.readFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      serverLog(`donation rank store could not be read: ${message}`, 'error');
    }
  }

  persist(): void {
    this.store.save(STORE_NAME, this.state);
  }

  keyFor(playerIdOrName: string): string {
    return this.resolveKey(playerIdOrName).trim().toLowerCase();
  }

  /** Active rank, or default when missing or expired. */
  effectiveRank(playerIdOrName: string, now = Date.now()): EffectiveRank {
    const grant = this.activeGrant(playerIdOrName, now);
    return grant?.rank ?? 'default';
  }

  activeGrant(playerIdOrName: string, now = Date.now()): RankGrant | undefined {
    if (this.readFailed) return undefined;
    const grant = this.state.grants[this.keyFor(playerIdOrName)];
    if (!grant || grant.expiresAt <= now) return undefined;
    return grant;
  }

  permissionNodes(playerIdOrName: string, now = Date.now()): string[] {
    const nodes = permissionNodesForRank(this.effectiveRank(playerIdOrName, now));
    if (!donationNodesAreNonAdmin(nodes)) return [];
    return nodes;
  }

  limit(playerIdOrName: string, kind: LimitKind, now = Date.now()): number {
    return RANK_LIMITS[this.effectiveRank(playerIdOrName, now)][kind];
  }

  nameStyle(playerIdOrName: string, operator: boolean, now = Date.now()): PlayerNameStyle | undefined {
    const rank = this.effectiveRank(playerIdOrName, now);
    const color = rank === 'premium' || rank === 'boss' || rank === 'titan'
      ? this.nickColor(playerIdOrName)
      : undefined;
    return playerNameStyle(rank, operator, color);
  }

  nickColor(playerIdOrName: string): NickColorId | undefined {
    if (this.readFailed) return undefined;
    return this.state.nickColors[this.keyFor(playerIdOrName)];
  }

  setNickColor(playerIdOrName: string, color: NickColorId | 'reset'): RankMutation {
    if (this.readFailed) return { ok: false, error: 'Не удалось прочитать данные привилегий.' };
    const key = this.keyFor(playerIdOrName);
    const previous = cloneStore(this.state);
    if (color === 'reset') delete this.state.nickColors[key];
    else this.state.nickColors[key] = color;
    return this.commit(previous, { ok: true });
  }

  /**
   * Replaces any active rank. The new end is `now + duration`, not the previous end.
   * Duration defaults to 30 days and is always stored as an absolute expiry.
   */
  grant(
    playerIdOrName: string,
    rank: DonationRankId,
    options: { readonly durationMs?: number; readonly now?: number; readonly source?: string } = {},
  ): RankMutation {
    if (this.readFailed) return { ok: false, error: 'Не удалось прочитать данные привилегий.' };
    const durationMs = options.durationMs ?? DONATION_RANK_DURATION_MS;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, error: 'Срок привилегии должен быть больше нуля.' };
    const now = options.now ?? Date.now();
    const key = this.keyFor(playerIdOrName);
    const previous = cloneStore(this.state);
    const current = this.state.grants[key];
    const active = current && current.expiresAt > now ? current : undefined;
    const action: RankChangeAction = active ? 'replace' : 'grant';
    const history = [...(current?.history ?? []), {
      at: now,
      action,
      rank,
      expiresAt: now + durationMs,
      ...(options.source ? { source: options.source } : {}),
    }].slice(-HISTORY_LIMIT);
    this.state.grants[key] = {
      rank,
      grantedAt: now,
      expiresAt: now + durationMs,
      ...(options.source ? { source: options.source } : {}),
      history,
    };
    return this.commit(previous, { ok: true, rank, expiresAt: now + durationMs });
  }

  /**
   * Adds the duration to the current end while the rank is still active.
   * An expired rank starts again from `now` and keeps the same rank.
   */
  extend(
    playerIdOrName: string,
    options: { readonly durationMs?: number; readonly now?: number; readonly source?: string } = {},
  ): RankMutation {
    if (this.readFailed) return { ok: false, error: 'Не удалось прочитать данные привилегий.' };
    const durationMs = options.durationMs ?? DONATION_RANK_DURATION_MS;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, error: 'Срок привилегии должен быть больше нуля.' };
    const now = options.now ?? Date.now();
    const key = this.keyFor(playerIdOrName);
    const current = this.state.grants[key];
    if (!current) return { ok: false, error: 'У игрока нет донатного ранга.' };
    const previous = cloneStore(this.state);
    const base = current.expiresAt > now ? current.expiresAt : now;
    const expiresAt = base + durationMs;
    const history = [...current.history, {
      at: now,
      action: 'extend' as const,
      rank: current.rank,
      expiresAt,
      ...(options.source ? { source: options.source } : {}),
    }].slice(-HISTORY_LIMIT);
    this.state.grants[key] = {
      ...current,
      grantedAt: current.expiresAt > now ? current.grantedAt : now,
      expiresAt,
      ...(options.source ? { source: options.source } : {}),
      history,
    };
    return this.commit(previous, { ok: true, rank: current.rank, expiresAt });
  }

  revoke(playerIdOrName: string, options: { readonly now?: number; readonly source?: string } = {}): RankMutation {
    if (this.readFailed) return { ok: false, error: 'Не удалось прочитать данные привилегий.' };
    const now = options.now ?? Date.now();
    const key = this.keyFor(playerIdOrName);
    const current = this.state.grants[key];
    if (!current || current.expiresAt <= now) return { ok: false, error: 'У игрока нет действующего ранга.' };
    const previous = cloneStore(this.state);
    const history = [...current.history, {
      at: now,
      action: 'revoke' as const,
      rank: 'default' as const,
      ...(options.source ? { source: options.source } : {}),
    }].slice(-HISTORY_LIMIT);
    this.state.grants[key] = { ...current, expiresAt: now, history };
    return this.commit(previous, { ok: true, rank: 'default', expiresAt: now });
  }

  peekCooldown(playerIdOrName: string, channel: CooldownChannel, limit: number, now = Date.now()): ReturnType<typeof slidingUse> {
    const stamps = this.stamps(playerIdOrName, channel);
    if (channel.startsWith('kit:')) {
      const rule = kitAccessRule(channel.slice(4));
      const period = rule?.periodMs ?? DONATION_DAY_MS;
      const last = stamps[0];
      if (last === undefined || now - last >= period) {
        return { used: 0, limit: 1, remainingMs: 0, allowed: true };
      }
      return { used: 1, limit: 1, remainingMs: last + period - now, allowed: false };
    }
    return slidingUse(stamps, limit, now);
  }

  /**
   * Reserves the use on disk before `commit` runs.
   * A failed reservation does not run the action.
   * A failed action removes the reservation when that write succeeds.
   * If the removal write fails, the reservation stays so a restart cannot grant a free use.
   */
  consumeIf(
    playerIdOrName: string,
    channel: CooldownChannel,
    limit: number,
    commit: () => boolean,
    now = Date.now(),
  ): { ok: true } | { ok: false; error: string; remainingMs?: number } {
    if (this.readFailed) return { ok: false, error: 'Не удалось прочитать данные привилегий.' };
    const key = this.keyFor(playerIdOrName);
    const lock = `${key}:${channel}`;
    if (this.busy.has(lock)) return { ok: false, error: 'Команда уже выполняется.' };
    const peek = this.peekCooldown(key, channel, limit, now);
    if (!peek.allowed) {
      return {
        ok: false,
        error: `Следующее использование через ${formatDurationMs(peek.remainingMs)}.`,
        remainingMs: peek.remainingMs,
      };
    }
    this.busy.add(lock);
    const previous = cloneStore(this.state);
    try {
      this.pushStamp(key, channel, now);
      const reserved = cloneStore(this.state);
      try {
        this.persist();
      } catch (error) {
        this.state = previous;
        const message = error instanceof Error ? error.message : String(error);
        serverLog(`donation cooldown write failed: ${message}`, 'error');
        return { ok: false, error: 'Не удалось сохранить кулдаун.' };
      }
      let committed = false;
      try {
        committed = commit();
      } catch {
        committed = false;
      }
      if (committed) return { ok: true };
      this.state = previous;
      try {
        this.persist();
      } catch (error) {
        this.state = reserved;
        const message = error instanceof Error ? error.message : String(error);
        serverLog(`donation cooldown rollback failed: ${message}`, 'error');
      }
      return { ok: false, error: 'Не удалось выполнить команду.' };
    } finally {
      this.busy.delete(lock);
    }
  }

  status(
    playerIdOrName: string,
    options: {
      readonly now?: number;
      readonly operator?: boolean;
      readonly homes?: number;
      readonly claims?: number;
      readonly auction?: number;
      readonly startReceived?: boolean;
    } = {},
  ): DonationStatus {
    const now = options.now ?? Date.now();
    if (this.readFailed) {
      return {
        rank: 'default',
        remainingMs: 0,
        limits: {
          homes: { max: 0 },
          claims: { max: 0 },
          auction: { max: 0 },
        },
        commands: [],
        kits: [],
        nick: { canColor: false, choices: [] },
        loadError: 'Не удалось прочитать данные привилегий.',
      };
    }
    const rank = this.effectiveRank(playerIdOrName, now);
    const grant = this.activeGrant(playerIdOrName, now);
    const limits = RANK_LIMITS[rank];
    const nodes = new Set(permissionNodesForRank(rank));
    const commands = this.commandInfo(playerIdOrName, nodes, limits, Boolean(options.operator), now);
    const kits = this.kitInfo(playerIdOrName, rank, Boolean(options.operator), Boolean(options.startReceived), now);
    const canColor = nodes.has('nick.color') || Boolean(options.operator);
    return {
      rank,
      ...(grant ? { expiresAt: grant.expiresAt } : {}),
      remainingMs: grant ? Math.max(0, grant.expiresAt - now) : 0,
      limits: {
        homes: { max: limits.homes, ...(options.homes !== undefined ? { current: options.homes } : {}) },
        claims: { max: limits.claims, ...(options.claims !== undefined ? { current: options.claims } : {}) },
        auction: { max: limits.auction, ...(options.auction !== undefined ? { current: options.auction } : {}) },
      },
      commands,
      kits,
      nick: {
        canColor,
        ...(canColor && this.nickColor(playerIdOrName) ? { color: this.nickColor(playerIdOrName) } : {}),
        choices: canColor ? NICK_COLOR_IDS : [],
      },
    };
  }

  private commandInfo(
    playerIdOrName: string,
    nodes: ReadonlySet<string>,
    limits: (typeof RANK_LIMITS)[EffectiveRank],
    operator: boolean,
    now: number,
  ): DonationCommandInfo[] {
    const row = (
      id: string,
      usage: string,
      available: boolean,
      channel?: CooldownChannel,
      limit?: number,
    ): DonationCommandInfo => {
      const cooldown = available && channel && limit
        ? this.peekCooldown(playerIdOrName, channel, limit, now).remainingMs
        : 0;
      return { id, usage, available, cooldownRemainingMs: cooldown };
    };
    const deathLimited = !operator && limits.deathBackPerDay !== null;
    return [
      row('ec', '/ec', operator || nodes.has('enderchest.use')),
      row('an', '/an <текст>', operator || nodes.has('announce.use'), 'announce', limits.announcePerDay || 1),
      row(
        'back-death',
        '/back',
        true,
        deathLimited ? 'deathBack' : undefined,
        deathLimited ? limits.deathBackPerDay ?? undefined : undefined,
      ),
      row('tp', '/tp <x> <y> <z>', operator || nodes.has('tp.coords'), 'coords', operator ? 0 : (limits.coordTeleportPerDay || 1)),
      row('invsee', '/invsee <игрок>', operator || nodes.has('invsee.use'), 'invsee', operator ? 0 : (limits.invseePerDay || 1)),
      row('invseeop', '/invseeop <игрок>', operator),
      row('nickcolor', '/nickcolor <цвет>', operator || nodes.has('nick.color')),
    ];
  }

  private kitInfo(
    playerIdOrName: string,
    rank: EffectiveRank,
    operator: boolean,
    startReceived: boolean,
    now: number,
  ): DonationKitInfo[] {
    return kitsForRank(operator ? 'titan' : rank).map((rule) => this.oneKit(playerIdOrName, rule, operator, startReceived, now));
  }

  private oneKit(
    playerIdOrName: string,
    rule: KitAccessRule,
    operator: boolean,
    startReceived: boolean,
    now: number,
  ): DonationKitInfo {
    if (rule.periodMs === null) {
      return { name: rule.name, available: !startReceived, cooldownRemainingMs: 0, once: true };
    }
    if (operator) return { name: rule.name, available: true, cooldownRemainingMs: 0, once: false };
    const peek = this.peekCooldown(playerIdOrName, `kit:${rule.name}`, 1, now);
    return { name: rule.name, available: peek.allowed, cooldownRemainingMs: peek.remainingMs, once: false };
  }

  private stamps(playerIdOrName: string, channel: CooldownChannel): number[] {
    const ledger = this.state.cooldowns[this.keyFor(playerIdOrName)] ?? emptyLedger();
    if (channel.startsWith('kit:')) {
      const stamp = ledger.kits[channel.slice(4)];
      return stamp === undefined ? [] : [stamp];
    }
    if (channel === 'announce') return ledger.announce;
    if (channel === 'deathBack') return ledger.deathBack;
    if (channel === 'coords') return ledger.coords;
    return ledger.invsee;
  }

  private pushStamp(key: string, channel: CooldownChannel, now: number): void {
    const ledger = this.state.cooldowns[key] ?? emptyLedger();
    if (channel.startsWith('kit:')) {
      ledger.kits[channel.slice(4)] = now;
    } else if (channel === 'announce') {
      ledger.announce = [...ledger.announce, now].filter((stamp) => now - stamp < DONATION_DAY_MS);
    } else if (channel === 'deathBack') {
      ledger.deathBack = [...ledger.deathBack, now].filter((stamp) => now - stamp < DONATION_DAY_MS);
    } else if (channel === 'coords') {
      ledger.coords = [...ledger.coords, now].filter((stamp) => now - stamp < DONATION_DAY_MS);
    } else {
      ledger.invsee = [...ledger.invsee, now].filter((stamp) => now - stamp < DONATION_DAY_MS);
    }
    this.state.cooldowns[key] = ledger;
  }

  private commit(previous: DonationStore, result: RankMutation): RankMutation {
    try {
      this.persist();
      return result;
    } catch (error) {
      this.state = previous;
      const message = error instanceof Error ? error.message : String(error);
      serverLog(`donation rank write failed: ${message}`, 'error');
      return { ok: false, error: 'Не удалось сохранить ранг.' };
    }
  }
}

export const DONATION_RANK_LIST = DONATION_RANKS;
