import { AdminActionService } from './action';
import { AdminActionValidationError } from './errors';
import { AdminAuditService, type AdminAuditRecord } from '../db/audit';
import { DatabaseDisabledError, IdempotencyConflictError } from '../db/errors';
import type { Database } from '../db/types';
import { parseUuid } from '../db/uuid';
import { EconomyValidationError } from '../economy/errors';
import { PostgresGameplayEconomy } from '../economy/postgresAuthority';
import { serverLog } from '../log';
import { ECONOMY_MAX_BALANCE } from '../services/economy';
import { isPlayerId } from '../services/permissionSubject';
import { clearBan, readBan, upsertBan, type BanRow } from './banAuthority';
import type { WorldInstance } from '../WorldInstance';

export interface AdminPanelApi {
  overview(): { readonly serverMode: string; readonly worldId: string; readonly online: number; readonly maxPlayers: number };
  players(query: string, cursor: string | undefined, limit: number): unknown;
  incidents(): unknown;
  resources(): unknown;
  serverStatus(startedAt: number): unknown;
  economy(playerId: string): Promise<unknown> | unknown;
  audit(limit: number, before?: { createdAt: string; eventId: string } | null): Promise<unknown>;
  recheck(adminId: string, requestId: string, reason: string): Promise<unknown>;
  kick(adminId: string, playerId: string, reason: string, requestId: string): Promise<unknown>;
  banView?(playerId: string): { readonly banned: boolean; readonly reason?: string };
  ban(adminId: string, playerId: string, reason: string, requestId: string): Promise<unknown>;
  unban(adminId: string, playerId: string, reason: string, requestId: string): Promise<unknown>;
  adjust(adminId: string, playerId: string, balance: number, reason: string, requestId: string): Promise<unknown>;
}

const REASON_TEXT = /^[\s\S]{1,200}$/;

export class PanelHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * Private panel operations for one world process.
 * Reads do not scan items. Writes require PostgreSQL and the session admin id.
 */
export class AdminPanelHost {
  private readonly auditLog: AdminAuditService | null;
  private readonly actions: AdminActionService | null;

  constructor(
    private readonly world: WorldInstance,
    private readonly closeConnection: (playerId: string, connectionId: string) => void,
    database: Database,
    deploymentId: string,
  ) {
    if (database.enabled) {
      this.auditLog = new AdminAuditService(database, deploymentId);
      this.actions = new AdminActionService(database, world.adminIdentity, deploymentId, this.auditLog);
    } else {
      this.auditLog = null;
      this.actions = null;
    }
  }

  /** Tests change the connection after it is captured and before commit. */
  onKickCaptured: ((playerId: string, connectionId: string) => void) | null = null;

  /** Tests pause after the authoritative read and before the cache write. */
  syncBarrier: ((playerId: string, row: BanRow | null) => Promise<void>) | null = null;

  /** Tests replace the post-commit read. Production uses `readBan`. */
  fetchBan: typeof readBan = readBan;

  overview(): {
    readonly serverMode: string;
    readonly worldId: string;
    readonly online: number;
    readonly maxPlayers: number;
  } {
    return {
      serverMode: this.world.serverMode,
      worldId: this.world.worldId,
      online: this.world.onlineCount(),
      maxPlayers: this.world.config.maxPlayers,
    };
  }

  players(query: string, cursor: string | undefined, limit: number) {
    return this.world.listAdminPlayers(query, cursor, limit);
  }

  incidents() {
    return { incidents: this.world.adminIncidents(), scanned: false as const };
  }

  resources() {
    return this.world.adminResources();
  }

  serverStatus(startedAt: number): {
    readonly serverMode: string;
    readonly worldId: string;
    readonly online: number;
    readonly maxPlayers: number;
    readonly configuredTickRate: number;
    readonly measuredTickMs: number | null;
    readonly uptimeSeconds: number;
    readonly postgres: boolean;
    readonly release: string | null;
  } {
    const measured = this.world.tickNumber > 0 ? this.world.lastTickMs : null;
    return {
      serverMode: this.world.serverMode,
      worldId: this.world.worldId,
      online: this.world.onlineCount(),
      maxPlayers: this.world.config.maxPlayers,
      configuredTickRate: this.world.config.tickRate,
      measuredTickMs: measured,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      postgres: this.world.database.enabled,
      release: null,
    };
  }

  async economy(playerId: string) {
    if (!isPlayerId(playerId)) throw new PanelHttpError(400, 'invalid request');
    const history = await this.world.money.getTransactionHistory(playerId, 20);
    return {
      playerId,
      balance: this.world.money.getBalance(playerId),
      backend: this.world.money.backend ?? 'legacy_json',
      entries: history,
    };
  }

  async audit(limit: number, before?: { createdAt: string; eventId: string } | null): Promise<{
    readonly entries: readonly AdminAuditRecord[];
  }> {
    if (!this.auditLog) throw new PanelHttpError(503, 'postgres-required');
    try {
      const entries = await this.auditLog.listRecent(limit, before);
      const last = entries[entries.length - 1];
      return {
        entries: entries.map(redactAudit),
        ...(entries.length === limit && last ? { nextCursor: `${last.createdAt}|${last.eventId}` } : {}),
      };
    } catch (error) {
      throw this.fail(error);
    }
  }

  async recheck(adminId: string, requestId: string, reason: string) {
    this.requireWrite(adminId, requestId, reason);
    const result = this.world.adminRecheck();
    if (!result.ok) throw new PanelHttpError(429, result.error === 'busy' ? 'busy' : 'rate');
    return { incidents: result.incidents, resources: result.resources, scanned: true as const };
  }

  banView(playerId: string): { readonly banned: boolean; readonly reason?: string } {
    return this.world.banView(playerId);
  }

  async kick(adminId: string, playerId: string, reason: string, requestId: string) {
    this.requireWrite(adminId, requestId, reason);
    if (!isPlayerId(playerId)) throw new PanelHttpError(400, 'invalid request');
    const actions = this.actions;
    if (!actions) throw new PanelHttpError(503, 'postgres-required');
    let committed: { readonly value: { connectionId: string }; readonly replayed: boolean };
    try {
      committed = await actions.commit(
        this.request(adminId, 'player_kick', 'player', playerId, reason, requestId),
        async () => {
          const connectionId = this.world.peekAdminConnection(playerId);
          if (!connectionId) throw new AdminActionValidationError('offline');
          this.onKickCaptured?.(playerId, connectionId);
          return { connectionId };
        },
      );
    } catch (error) {
      throw this.fail(error);
    }
    if (committed.replayed) return { ok: true as const, replayed: true, closed: false };
    const delivery = this.world.disconnectAdminConnection(playerId, committed.value.connectionId);
    if (delivery === 'closed') this.closeConnection(playerId, committed.value.connectionId);
    return { ok: true as const, replayed: false, closed: delivery === 'closed', delivery };
  }

  async ban(adminId: string, playerId: string, reason: string, requestId: string) {
    return this.changeBan(adminId, playerId, reason, requestId, true);
  }

  async unban(adminId: string, playerId: string, reason: string, requestId: string) {
    return this.changeBan(adminId, playerId, reason, requestId, false);
  }

  async adjust(adminId: string, playerId: string, balance: number, reason: string, requestId: string) {
    this.requireWrite(adminId, requestId, reason);
    if (!isPlayerId(playerId)) throw new PanelHttpError(400, 'invalid request');
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > ECONOMY_MAX_BALANCE) {
      throw new PanelHttpError(400, 'invalid request');
    }
    const money = this.world.money;
    const audit = this.auditLog;
    if (!(money instanceof PostgresGameplayEconomy) || !audit) {
      throw new PanelHttpError(503, 'postgres-required');
    }
    const result = await money.setBalanceAudited(playerId, balance, 'ADMIN_SET', {
      requestId,
      operation: 'admin_set_balance',
      actorId: adminId,
      payload: {
        playerId,
        balance,
        reason,
        serverMode: this.world.serverMode,
        worldId: this.world.worldId,
      },
    }, async (tx) => {
      await audit.append({
      requestId,
      adminId,
      action: 'economy_set_balance',
      targetType: 'player',
      targetId: playerId,
      reason,
      serverMode: this.world.serverMode,
      worldId: this.world.worldId,
      success: true,
      metadata: { balance },
    }, tx);
    });
    if (!result.ok) {
      await this.noteFailure(audit, adminId, 'economy_set_balance', playerId, reason, requestId, result.error ?? 'rejected');
      throw new PanelHttpError(409, 'rejected');
    }
    return { ok: true as const, balance: result.balance ?? balance, replayed: Boolean(result.replayed) };
  }

  private async changeBan(
    adminId: string,
    playerId: string,
    reason: string,
    requestId: string,
    ban: boolean,
  ) {
    this.requireWrite(adminId, requestId, reason);
    if (!isPlayerId(playerId)) throw new PanelHttpError(400, 'invalid request');
    const actions = this.actions;
    if (!actions || !this.world.database.enabled) throw new PanelHttpError(503, 'postgres-required');
    const deploymentId = this.auditLog?.deploymentId;
    if (!deploymentId) throw new PanelHttpError(503, 'postgres-required');
    const scope = { deploymentId, worldId: this.world.worldId, playerId, reason, adminId };
    this.world.beginBanSync(playerId);
    let committedOk = false;
    let replayed = false;
    try {
      const committed = await actions.commit(this.request(
        adminId,
        ban ? 'player_ban' : 'player_unban',
        'player',
        playerId,
        reason,
        requestId,
        { ban },
      ), async (tx) => {
        if (ban) await upsertBan(tx, scope);
        else if (!await clearBan(tx, scope)) throw new AdminActionValidationError('not-banned');
        return { ban };
      });
      committedOk = true;
      replayed = committed.replayed;
      const current = await this.fetchBan(this.world.database, deploymentId, this.world.worldId, playerId);
      if (this.syncBarrier) await this.syncBarrier(playerId, current);
      const applied = this.world.syncBanCache(playerId, current);
      this.world.clearBanUnsynced(playerId);
      this.world.endBanSync(playerId);
      let closed = false;
      if (!replayed && applied && current?.banned) {
        const connectionId = this.world.peekAdminConnection(playerId);
        if (connectionId) {
          const delivery = this.world.disconnectAdminConnection(playerId, connectionId);
          if (delivery === 'closed') {
            this.closeConnection(playerId, connectionId);
            closed = true;
          }
        }
      }
      return {
        ok: true as const,
        replayed,
        banned: this.world.storedBan(playerId),
        closed,
      };
    } catch (error) {
      if (!committedOk) this.world.endBanSync(playerId);
      else {
        this.world.markBanUnsynced(playerId);
        this.world.endBanSync(playerId);
        if (!replayed && ban) this.disconnectOnline(playerId);
      }
      throw this.fail(error);
    }
  }

  private disconnectOnline(playerId: string): void {
    const connectionId = this.world.peekAdminConnection(playerId);
    if (!connectionId) return;
    if (this.world.disconnectAdminConnection(playerId, connectionId) === 'closed') {
      this.closeConnection(playerId, connectionId);
    }
  }

  private request(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    reason: string,
    requestId: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      requestId,
      adminId,
      action,
      targetType,
      targetId,
      reason,
      serverMode: this.world.serverMode,
      worldId: this.world.worldId,
      payload: { playerId: targetId, ...extra },
    };
  }

  private requireWrite(adminId: string, requestId: string, reason: string): void {
    if (!adminId || !parseUuid(requestId) || !REASON_TEXT.test(reason.trim())) {
      throw new PanelHttpError(400, 'invalid request');
    }
  }

  private fail(error: unknown): PanelHttpError {
    if (error instanceof PanelHttpError) return error;
    if (error instanceof AdminActionValidationError) {
      return new PanelHttpError(409, error.message === 'offline' ? 'offline' : 'rejected');
    }
    if (error instanceof EconomyValidationError) return new PanelHttpError(400, 'invalid request');
    if (error instanceof IdempotencyConflictError) return new PanelHttpError(409, 'conflict');
    if (error instanceof DatabaseDisabledError) return new PanelHttpError(503, 'postgres-required');
    const detail = error instanceof Error ? error.message : String(error);
    serverLog(`admin panel action failed: ${detail.slice(0, 180)}`, 'error');
    return new PanelHttpError(503, 'unavailable');
  }

  private async noteFailure(
    audit: AdminAuditService,
    adminId: string,
    action: string,
    playerId: string,
    reason: string,
    requestId: string,
    code: string,
  ): Promise<void> {
    try {
      await audit.append({
        requestId,
        adminId,
        action,
        targetType: 'player',
        targetId: playerId,
        reason,
        serverMode: this.world.serverMode,
        worldId: this.world.worldId,
        success: false,
        metadata: { errorCode: code },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      serverLog(`admin failure audit was not stored: ${detail.slice(0, 180)}`, 'error');
    }
  }
}

function redactAudit(row: AdminAuditRecord): AdminAuditRecord {
  const metadata = { ...row.metadata };
  for (const key of Object.keys(metadata)) {
    if (/token|secret|password|session/i.test(key)) delete metadata[key];
  }
  return { ...row, metadata };
}
