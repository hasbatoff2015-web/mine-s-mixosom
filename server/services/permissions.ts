import { serverLog } from '../log';
import type { JsonFileStore } from './jsonStore';
import { canonicalPlayerId, isPlayerId } from './permissionSubject';

export const ALL_PERMISSION = '*';

export interface RoleDefinition {
  readonly name: string;
  permissions: string[];
}

export const PERMISSION_STATE_VERSION = 3;

/** Nickname-keyed grants. They are kept and never authorize a player. */
export interface LegacyPermissionSubjects {
  ops: string[];
  playerRoles: Record<string, string[]>;
  playerPermissions: Record<string, string[]>;
}

export interface PermissionState {
  version: typeof PERMISSION_STATE_VERSION;
  ops: string[];
  /** Saved player ids whose OP source could not be proven. They do not authorize. */
  unreviewedOps: string[];
  roles: Record<string, string[]>;
  playerRoles: Record<string, string[]>;
  playerPermissions: Record<string, string[]>;
  legacy: LegacyPermissionSubjects;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  default: [
    'spawn.use',
    'home.use',
    'home.sethome',
    'tpa.use',
    'tpa.accept',
    'rtp.use',
    'back.use',
    'claim.use',
    'claim.create',
    'economy.balance',
    'economy.pay',
    'economy.baltop',
    'economy.transactions',
    'auction.use',
    'auction.sell',
    'auction.buy',
    'auction.list',
    'clan.use',
    'clan.create',
    'clan.delete',
    'clan.add',
    'clan.accept',
    'clan.leave',
    'clan.makeleader',
    'clan.kick',
    'clan.list',
    'buyer.use',
    'friends.use',
    'friends.teleport',
    'trade.use',
  ],
  moderator: [
    'claim.admin',
    'holograms.create',
    'rtpportal.use',
  ],
  admin: [
    'server.*',
    'plugins.manage',
    'claim.*',
    'holograms.*',
    'home.*',
    'tpa.*',
    'rtp.*',
    'rtpportal.*',
    'spawn.*',
    'back.*',
    'automine.*',
    'wand.*',
    'events.*',
    'economy.*',
    'auction.*',
    'clan.*',
    'buyer.*',
    'friends.*',
    'trade.*',
    'duels.admin',
  ],
  vip: [
    'home.multiple',
  ],
  premium: [
    'home.multiple',
    'home.limit.premium',
  ],
  pet_plus: [
    'pets.limit.3',
  ],
  pet_master: [
    'pets.limit.5',
  ],
};

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function permissionMatches(granted: string, needed: string): boolean {
  const have = granted.trim().toLowerCase();
  const want = needed.trim().toLowerCase();
  if (!have || !want) return false;
  if (have === ALL_PERMISSION || have === want) return true;
  if (have.endsWith('.*')) {
    const prefix = have.slice(0, -1);
    const root = have.slice(0, -2);
    return want === root || want.startsWith(prefix);
  }
  return false;
}

interface LegacyMaps {
  ops: Set<string>;
  playerRoles: Map<string, Set<string>>;
  playerPermissions: Map<string, Set<string>>;
}

export class PermissionService {
  private ops = new Set<string>();
  private envOps = new Set<string>();
  private unreviewedOps = new Set<string>();
  private roles = new Map<string, Set<string>>();
  private playerRoles = new Map<string, Set<string>>();
  private playerPermissions = new Map<string, Set<string>>();
  private legacy: LegacyMaps = emptyLegacy();
  private ignoredEnvOperators: string[] = [];

  constructor(
    private readonly store: JsonFileStore,
    private readonly envOperators: readonly string[] = [],
  ) {
    this.resetDefaults();
  }

  load(): void {
    const saved = this.store.load<Partial<PermissionState>>('permissions', {});
    this.resetDefaults();
    if (saved.roles) {
      for (const [name, nodes] of Object.entries(saved.roles)) {
        const set = this.roles.get(normalize(name)) ?? new Set<string>();
        for (const node of nodes) set.add(node);
        this.roles.set(normalize(name), set);
      }
    }
    const legacy = emptyLegacy();
    const savedVersion = saved.version === PERMISSION_STATE_VERSION ? PERMISSION_STATE_VERSION : 0;
    for (const raw of saved.ops ?? []) {
      this.takeSubject(
        raw,
        (id) => {
          if (savedVersion >= PERMISSION_STATE_VERSION) this.ops.add(id);
          else this.unreviewedOps.add(id);
        },
        (name) => legacy.ops.add(name),
      );
    }
    for (const raw of saved.unreviewedOps ?? []) {
      if (typeof raw === 'string' && isPlayerId(raw)) this.unreviewedOps.add(canonicalPlayerId(raw));
    }
    for (const [player, roles] of Object.entries(saved.playerRoles ?? {})) {
      this.takeSubject(
        player,
        (id) => this.playerRoles.set(id, new Set(roles.map(normalize))),
        (name) => mergeLegacy(legacy.playerRoles, name, roles.map(normalize)),
      );
    }
    for (const [player, nodes] of Object.entries(saved.playerPermissions ?? {})) {
      this.takeSubject(
        player,
        (id) => this.playerPermissions.set(id, new Set(nodes)),
        (name) => mergeLegacy(legacy.playerPermissions, name, nodes),
      );
    }
    for (const raw of saved.legacy?.ops ?? []) {
      const name = normalize(raw);
      if (name && !isPlayerId(name)) legacy.ops.add(name);
    }
    for (const [player, roles] of Object.entries(saved.legacy?.playerRoles ?? {})) {
      const name = normalize(player);
      if (name && !isPlayerId(name)) mergeLegacy(legacy.playerRoles, name, roles.map(normalize));
    }
    for (const [player, nodes] of Object.entries(saved.legacy?.playerPermissions ?? {})) {
      const name = normalize(player);
      if (name && !isPlayerId(name)) mergeLegacy(legacy.playerPermissions, name, nodes);
    }
    this.legacy = legacy;
    this.ignoredEnvOperators = [];
    this.envOps = new Set();
    for (const entry of this.envOperators) {
      if (isPlayerId(entry)) this.envOps.add(canonicalPlayerId(entry));
      else if (entry.trim()) this.ignoredEnvOperators.push(entry.trim());
    }
    if (this.ignoredEnvOperators.length > 0) {
      serverLog(
        `FC_OPERATORS ignored ${this.ignoredEnvOperators.length} nickname entry. `
        + 'The allowlist accepts player ids only. See docs/PERMISSIONS.md',
      );
    }
    this.persist();
  }

  persist(): void {
    this.store.save('permissions', this.snapshot());
  }

  snapshot(): PermissionState {
    return {
      version: PERMISSION_STATE_VERSION,
      ops: [...this.ops].sort(),
      unreviewedOps: [...this.unreviewedOps].sort(),
      roles: Object.fromEntries([...this.roles.entries()].map(([name, nodes]) => [name, [...nodes].sort()])),
      playerRoles: Object.fromEntries(
        [...this.playerRoles.entries()].map(([name, roles]) => [name, [...roles].sort()]),
      ),
      playerPermissions: Object.fromEntries(
        [...this.playerPermissions.entries()].map(([name, nodes]) => [name, [...nodes].sort()]),
      ),
      legacy: {
        ops: [...this.legacy.ops].sort(),
        playerRoles: Object.fromEntries(
          [...this.legacy.playerRoles.entries()].map(([name, roles]) => [name, [...roles].sort()]),
        ),
        playerPermissions: Object.fromEntries(
          [...this.legacy.playerPermissions.entries()].map(([name, nodes]) => [name, [...nodes].sort()]),
        ),
      },
    };
  }

  /** Active subject. A nickname is not a key. */
  keyFor(playerId: string): string {
    return isPlayerId(playerId) ? canonicalPlayerId(playerId) : '';
  }

  ignoredOperators(): readonly string[] {
    return this.ignoredEnvOperators;
  }

  legacyInfo(nickname: string): { operator: boolean; roles: string[]; permissions: string[] } | null {
    const name = normalize(nickname);
    if (!name || isPlayerId(name)) return null;
    const roles = this.legacy.playerRoles.get(name);
    const permissions = this.legacy.playerPermissions.get(name);
    const operator = this.legacy.ops.has(name);
    if (!operator && !roles?.size && !permissions?.size) return null;
    return {
      operator,
      roles: [...(roles ?? [])].sort(),
      permissions: [...(permissions ?? [])].sort(),
    };
  }

  isOperator(playerId: string): boolean {
    const key = this.keyFor(playerId);
    return key !== '' && (this.ops.has(key) || this.envOps.has(key));
  }

  isEnvOperator(playerId: string): boolean {
    const key = this.keyFor(playerId);
    return key !== '' && this.envOps.has(key);
  }

  op(playerId: string): boolean {
    const key = this.keyFor(playerId);
    if (!key || this.ops.has(key)) return false;
    this.ops.add(key);
    this.persist();
    return true;
  }

  deop(playerId: string): { ok: boolean; error?: string } {
    const key = this.keyFor(playerId);
    if (!key) return { ok: false, error: 'Player id is required.' };
    if (this.isEnvOperator(key)) {
      return { ok: false, error: `${key} is listed in FC_OPERATORS and cannot be deopped.` };
    }
    if (!this.ops.has(key)) return { ok: false, error: `${key} is not an operator.` };
    this.ops.delete(key);
    this.persist();
    return { ok: true };
  }

  has(playerId: string, node: string): boolean {
    const key = this.keyFor(playerId);
    if (this.isOperator(playerId)) return true;
    for (const granted of this.collect(key)) {
      if (permissionMatches(granted, node)) return true;
    }
    return false;
  }

  grant(playerId: string, node: string): boolean {
    const key = this.keyFor(playerId);
    const trimmed = node.trim();
    if (!key || !trimmed) return false;
    const set = this.playerPermissions.get(key) ?? new Set<string>();
    set.add(trimmed);
    this.playerPermissions.set(key, set);
    this.persist();
    return true;
  }

  revoke(playerId: string, node: string): boolean {
    const key = this.keyFor(playerId);
    const set = key ? this.playerPermissions.get(key) : undefined;
    if (!set) return false;
    const wanted = node.trim().toLowerCase();
    let removed = false;
    for (const granted of [...set]) {
      if (granted.toLowerCase() === wanted) {
        set.delete(granted);
        removed = true;
      }
    }
    if (removed) this.persist();
    return removed;
  }

  assignRole(playerId: string, role: string): { ok: boolean; error?: string } {
    const roleName = normalize(role);
    if (!this.roles.has(roleName)) return { ok: false, error: `Role '${role}' not found.` };
    const key = this.keyFor(playerId);
    if (!key) return { ok: false, error: 'Player id is required.' };
    const set = this.playerRoles.get(key) ?? new Set<string>();
    set.add(roleName);
    this.playerRoles.set(key, set);
    this.persist();
    return { ok: true };
  }

  unassignRole(playerId: string, role: string): boolean {
    const key = this.keyFor(playerId);
    const set = key ? this.playerRoles.get(key) : undefined;
    if (!set) return false;
    const removed = set.delete(normalize(role));
    if (removed) this.persist();
    return removed;
  }

  /**
   * Move one inert nickname entry onto a confirmed player id.
   * A matching online nickname is not accepted as that confirmation.
   */
  migrateLegacy(legacyName: string, playerId: string): { ok: boolean; error?: string } {
    const name = normalize(legacyName);
    const key = this.keyFor(playerId);
    if (!name || isPlayerId(name)) return { ok: false, error: 'Legacy entry was not found.' };
    if (!key) return { ok: false, error: 'Player id is required.' };
    const hadOp = this.legacy.ops.has(name);
    const roles = this.legacy.playerRoles.get(name);
    const nodes = this.legacy.playerPermissions.get(name);
    if (!hadOp && !roles?.size && !nodes?.size) return { ok: false, error: 'Legacy entry was not found.' };
    if (hadOp) {
      this.legacy.ops.delete(name);
      this.ops.add(key);
    }
    if (roles) {
      const set = this.playerRoles.get(key) ?? new Set<string>();
      for (const role of roles) {
        if (this.roles.has(role)) set.add(role);
      }
      this.playerRoles.set(key, set);
      this.legacy.playerRoles.delete(name);
    }
    if (nodes) {
      const set = this.playerPermissions.get(key) ?? new Set<string>();
      for (const node of nodes) set.add(node);
      this.playerPermissions.set(key, set);
      this.legacy.playerPermissions.delete(name);
    }
    this.persist();
    return { ok: true };
  }

  createRole(name: string): { ok: boolean; error?: string } {
    const roleName = normalize(name);
    if (!roleName) return { ok: false, error: 'Role name is required.' };
    if (this.roles.has(roleName)) return { ok: false, error: `Role '${roleName}' already exists.` };
    this.roles.set(roleName, new Set());
    this.persist();
    return { ok: true };
  }

  deleteRole(name: string): { ok: boolean; error?: string } {
    const roleName = normalize(name);
    if (roleName === 'default') return { ok: false, error: "Role 'default' cannot be deleted." };
    if (!this.roles.has(roleName)) return { ok: false, error: `Role '${name}' not found.` };
    this.roles.delete(roleName);
    for (const roles of this.playerRoles.values()) roles.delete(roleName);
    this.persist();
    return { ok: true };
  }

  addRolePermission(role: string, node: string): { ok: boolean; error?: string } {
    const roleName = normalize(role);
    const set = this.roles.get(roleName);
    if (!set) return { ok: false, error: `Role '${role}' not found.` };
    set.add(node.trim());
    this.persist();
    return { ok: true };
  }

  removeRolePermission(role: string, node: string): { ok: boolean; error?: string } {
    const roleName = normalize(role);
    const set = this.roles.get(roleName);
    if (!set) return { ok: false, error: `Role '${role}' not found.` };
    const wanted = node.trim().toLowerCase();
    let removed = false;
    for (const granted of [...set]) {
      if (granted.toLowerCase() === wanted) {
        set.delete(granted);
        removed = true;
      }
    }
    this.persist();
    return removed ? { ok: true } : { ok: false, error: `Role '${role}' does not have '${node}'.` };
  }

  listRoles(): string[] {
    return [...this.roles.keys()].sort();
  }

  rolePermissions(role: string): string[] {
    return [...(this.roles.get(normalize(role)) ?? [])].sort();
  }

  playerInfo(playerId: string): {
    readonly key: string;
    readonly operator: boolean;
    readonly roles: string[];
    readonly permissions: string[];
  } {
    const key = this.keyFor(playerId);
    return {
      key,
      operator: this.isOperator(playerId),
      roles: this.rolesOf(key),
      permissions: [...this.collect(key)].sort(),
    };
  }

  private takeSubject(raw: string, keep: (playerId: string) => void, park: (nickname: string) => void): void {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (isPlayerId(trimmed)) keep(canonicalPlayerId(trimmed));
    else park(normalize(trimmed));
  }

  private rolesOf(key: string): string[] {
    const assigned = key ? this.playerRoles.get(key) : undefined;
    const roles = new Set<string>(['default']);
    if (assigned) for (const role of assigned) roles.add(role);
    return [...roles].sort();
  }

  private collect(key: string): Set<string> {
    const nodes = new Set<string>();
    for (const role of this.rolesOf(key)) {
      const set = this.roles.get(role);
      if (set) for (const node of set) nodes.add(node);
    }
    const extra = key ? this.playerPermissions.get(key) : undefined;
    if (extra) for (const node of extra) nodes.add(node);
    return nodes;
  }

  private resetDefaults(): void {
    this.ops = new Set();
    this.envOps = new Set();
    this.unreviewedOps = new Set();
    this.ignoredEnvOperators = [];
    this.legacy = emptyLegacy();
    this.roles = new Map();
    for (const [name, nodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      this.roles.set(name, new Set(nodes));
    }
    this.playerRoles = new Map();
    this.playerPermissions = new Map();
  }
}

function emptyLegacy(): LegacyMaps {
  return { ops: new Set(), playerRoles: new Map(), playerPermissions: new Map() };
}

function mergeLegacy(map: Map<string, Set<string>>, name: string, values: readonly string[]): void {
  const set = map.get(name) ?? new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  }
  map.set(name, set);
}
