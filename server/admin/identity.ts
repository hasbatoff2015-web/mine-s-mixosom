import type { AdminIdentityConfig } from '../config';
import { AdminControlDisabledError, AdminIdentityError } from './errors';

/**
 * Exactly two equal administrators. This is not PermissionService, `/op`,
 * or FC_OPERATORS. Future authentication maps a credential onto one of these ids.
 * There is no rank, level, or partial permission between them.
 */
export class AdminIdentityPolicy {
  private readonly allowed: ReadonlySet<string>;

  constructor(readonly config: AdminIdentityConfig) {
    this.allowed = config.enabled ? new Set(config.ids) : new Set();
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Internal ids. Do not put this list on /status or in a client message. */
  authorizedIds(): readonly string[] {
    return this.config.enabled ? [...this.config.ids] : [];
  }

  isAdmin(adminId: string): boolean {
    if (!this.config.enabled) return false;
    return this.allowed.has(adminId);
  }

  requireAdmin(adminId: string): void {
    if (!this.config.enabled) throw new AdminControlDisabledError();
    if (!this.isAdmin(adminId)) throw new AdminIdentityError();
  }
}
