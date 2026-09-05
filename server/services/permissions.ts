import type { JsonFileStore } from './jsonStore';

export const ALL_PERMISSION = '*';

export interface RoleDefinition {
  readonly name: string;
  permissions: string[];
}

export interface PermissionState {
  ops: string[];
  roles: Record<string, string[]>;
  playerRoles: Record<string, string[]>;
  playerPermissions: Record<string, string[]>;
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
  ],
  vip: [
    'home.multiple',
  ],
  premium: [
    'home.multiple',
    'home.limit.premium',
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

export class PermissionService {
  private ops = new Set<string>();
  private roles = new Map<string, Set<string>>();
  private playerRoles = new Map<string, Set<string>>();
  private playerPermissions = new Map<string, Set<string>>();

  constructor(
    private readonly store: JsonFileStore,
    private readonly envOperators: readonly string[] = [],
    private readonly resolveKey: (playerIdOrName: string) => string = (value) => normalize(value),
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
    if (saved.playerRoles) {
      for (const [player, roles] of Object.entries(saved.playerRoles)) {
        this.playerRoles.set(normalize(player), new Set(roles.map(normalize)));
      }
    }
    if (saved.playerPermissions) {
      for (const [player, nodes] of Object.entries(saved.playerPermissions)) {
        this.playerPermissions.set(normalize(player), new Set(nodes));
      }
    }
    this.ops = new Set((saved.ops ?? []).map(normalize));
    for (const name of this.envOperators) this.ops.add(normalize(name));
    this.persist();
  }

  persist(): void {
    this.store.save('permissions', this.snapshot());
  }

  snapshot(): PermissionState {
    return {
      ops: [...this.ops].sort(),
      roles: Object.fromEntries([...this.roles.entries()].map(([name, nodes]) => [name, [...nodes].sort()])),
      playerRoles: Object.fromEntries(
        [...this.playerRoles.entries()].map(([name, roles]) => [name, [...roles].sort()]),
      ),
      playerPermissions: Object.fromEntries(
        [...this.playerPermissions.entries()].map(([name, nodes]) => [name, [...nodes].sort()]),
      ),
    };
  }

  keyFor(playerIdOrName: string): string {
    return normalize(this.resolveKey(playerIdOrName));
  }

  isOperator(playerIdOrName: string): boolean {
    return this.ops.has(this.keyFor(playerIdOrName));
  }

  isEnvOperator(playerIdOrName: string): boolean {
    return this.envOperators.map(normalize).includes(this.keyFor(playerIdOrName));
  }

  op(playerIdOrName: string): boolean {
    const key = this.keyFor(playerIdOrName);
    if (this.ops.has(key)) return false;
    this.ops.add(key);
    this.persist();
    return true;
  }

  deop(playerIdOrName: string): { ok: boolean; error?: string } {
    const key = this.keyFor(playerIdOrName);
    if (this.isEnvOperator(key)) {
      return { ok: false, error: `${key} is listed in FC_OPERATORS and cannot be deopped.` };
    }
    if (!this.ops.has(key)) return { ok: false, error: `${key} is not an operator.` };
    this.ops.delete(key);
    this.persist();
    return { ok: true };
  }

  has(playerIdOrName: string, node: string): boolean {
    const key = this.keyFor(playerIdOrName);
    if (this.ops.has(key)) return true;
    for (const granted of this.collect(key)) {
      if (permissionMatches(granted, node)) return true;
    }
    return false;
  }

  grant(playerIdOrName: string, node: string): void {
    const key = this.keyFor(playerIdOrName);
    const set = this.playerPermissions.get(key) ?? new Set<string>();
    set.add(node.trim());
    this.playerPermissions.set(key, set);
    this.persist();
  }

  revoke(playerIdOrName: string, node: string): boolean {
    const key = this.keyFor(playerIdOrName);
    const set = this.playerPermissions.get(key);
    if (!set) return false;
    const wanted = node.trim().toLowerCase();
    let removed = false;
    for (const granted of [...set]) {
      if (granted.toLowerCase() === wanted) {
        set.delete(granted);
        removed = true;
      }
    }
    this.persist();
    return removed;
  }

  assignRole(playerIdOrName: string, role: string): { ok: boolean; error?: string } {
    const roleName = normalize(role);
    if (!this.roles.has(roleName)) return { ok: false, error: `Role '${role}' not found.` };
    const key = this.keyFor(playerIdOrName);
    const set = this.playerRoles.get(key) ?? new Set<string>();
    set.add(roleName);
    this.playerRoles.set(key, set);
    this.persist();
    return { ok: true };
  }

  unassignRole(playerIdOrName: string, role: string): boolean {
    const key = this.keyFor(playerIdOrName);
    const set = this.playerRoles.get(key);
    if (!set) return false;
    const removed = set.delete(normalize(role));
    this.persist();
    return removed;
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

  playerInfo(playerIdOrName: string): {
    readonly key: string;
    readonly operator: boolean;
    readonly roles: string[];
    readonly permissions: string[];
  } {
    const key = this.keyFor(playerIdOrName);
    return {
      key,
      operator: this.ops.has(key),
      roles: this.rolesOf(key),
      permissions: [...this.collect(key)].sort(),
    };
  }

  private rolesOf(key: string): string[] {
    const assigned = this.playerRoles.get(key);
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
    const extra = this.playerPermissions.get(key);
    if (extra) for (const node of extra) nodes.add(node);
    return nodes;
  }

  private resetDefaults(): void {
    this.ops = new Set(this.envOperators.map(normalize));
    this.roles = new Map();
    for (const [name, nodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      this.roles.set(name, new Set(nodes));
    }
    this.playerRoles = new Map();
    this.playerPermissions = new Map();
  }
}
