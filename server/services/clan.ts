import type {
  ClientClanActionMessage,
  ServerClanMessage,
  NetworkClanInvitation,
  NetworkClanMember,
  NetworkClanPlayerRow,
  NetworkClanRow,
} from '../../shared/protocol';
import {
  CLAN_CREATE_COST,
  CLAN_ICON_IDS,
  CLAN_INVITE_TTL_MS,
  CLAN_MAX_MEMBERS,
  CLAN_NAME_MAX,
  CLAN_PAGE_SIZE,
  CLAN_PLUGIN_NAME,
  CLAN_REQUEST_TTL_MS,
  clanNameKey,
  defaultClanCreatePolicy,
  isClanIconId,
  validateClanName,
  type ClanCreatePolicy,
  type ClanIconId,
} from '../../shared/clans';
import { formatCompactMegacoins } from '../../shared/megacoins';
import type { EconomyService } from './economy';
import type { JsonFileStore } from './jsonStore';

export { CLAN_PLUGIN_NAME, CLAN_CREATE_COST, CLAN_MAX_MEMBERS, CLAN_PAGE_SIZE };

export const CLAN_BUSY_ERROR = 'Подождите, действие уже выполняется.';
export const CLAN_ALREADY_MEMBER_ERROR = 'Вы уже состоите в клане.';
export const CLAN_ALREADY_OTHER_CLAN_ERROR = 'Вы уже состоите в другом клане.';
export const CLAN_NOT_IN_CLAN_ERROR = 'Вы не состоите в клане.';
export const CLAN_OWNER_ONLY_ERROR = 'Это действие доступно только владельцу клана.';
export const CLAN_OWNER_LEAVE_ERROR = 'Владелец не может покинуть клан. Сначала передайте лидерство командой /clan makeleader.';
export const CLAN_FULL_ERROR = 'Клан заполнен';
export const CLAN_MISSING_ERROR = 'Клан не найден.';
export const CLAN_NAME_TAKEN_ERROR = 'Клан с таким названием уже существует.';
export const CLAN_ICON_ERROR = 'Выберите значок клана.';
export const CLAN_OFFLINE_INVITE_ERROR = 'Пригласить можно только игрока, который сейчас в сети.';
export const CLAN_INVITE_SELF_ERROR = 'Нельзя пригласить самого себя.';
export const CLAN_TARGET_IN_CLAN_ERROR = 'Этот игрок уже состоит в клане.';
export const CLAN_INVITE_MISSING_ERROR = 'Приглашение не найдено или истекло.';
export const CLAN_REQUEST_MISSING_ERROR = 'Заявка не найдена или истекла.';
export const CLAN_KICK_SELF_ERROR = 'Нельзя выгнать самого себя.';
export const CLAN_NOT_MEMBER_ERROR = 'Этот игрок не состоит в вашем клане.';
export const CLAN_LEADER_SELF_ERROR = 'Вы уже владелец этого клана.';

export type ClanView =
  | 'ranking'
  | 'create'
  | 'delete'
  | 'add'
  | 'accept'
  | 'leave'
  | 'makeleader'
  | 'kick';

export type ClanScreen =
  | 'ranking'
  | 'card'
  | 'create'
  | 'create-confirm'
  | 'delete-confirm'
  | 'add'
  | 'invite-confirm'
  | 'accept'
  | 'accept-confirm'
  | 'leave-confirm'
  | 'makeleader'
  | 'makeleader-confirm'
  | 'kick-confirm'
  | 'requests'
  | 'request-confirm'
  | 'join-confirm'
  | 'replace-request-confirm'
  | 'closed';

export interface ClanRecord {
  clanId: string;
  name: string;
  nameKey: string;
  icon: ClanIconId;
  ownerId: string;
  memberIds: string[];
  createdAt: number;
}

export interface ClanInvitation {
  invitationId: string;
  clanId: string;
  fromPlayerId: string;
  toPlayerId: string;
  createdAt: number;
  expiresAt: number;
}

export interface ClanJoinRequest {
  requestId: string;
  clanId: string;
  playerId: string;
  createdAt: number;
  expiresAt: number;
}

export interface ClanResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly clan?: ClanRecord;
}

export interface ClanRuntime {
  onlinePlayers(): readonly { id: string; name: string }[];
  isOnline(playerId: string): boolean;
  displayName(playerId: string): string;
}

export interface ClanSession {
  screen: ClanScreen;
  search: string;
  page: number;
  selectedClanId?: string;
  selectedIcon: ClanIconId;
  nameText: string;
  selectedPlayerId?: string;
  selectedInvitationId?: string;
  selectedRequestId?: string;
  selectedMemberId?: string;
  message?: string;
}

interface ClanFile {
  nextClanId: number;
  nextInvitationId: number;
  nextRequestId: number;
  clans: unknown[];
  invitations: unknown[];
  requests: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function emptyRuntime(): ClanRuntime {
  return {
    onlinePlayers: () => [],
    isOnline: () => false,
    displayName: (id) => id.slice(0, 8),
  };
}

function parseClan(value: unknown): ClanRecord | undefined {
  if (!isRecord(value) || typeof value.clanId !== 'string' || typeof value.name !== 'string') return undefined;
  if (typeof value.ownerId !== 'string' || typeof value.icon !== 'string' || !isClanIconId(value.icon)) return undefined;
  if (!Array.isArray(value.memberIds)) return undefined;
  const memberIds = value.memberIds.filter((id): id is string => typeof id === 'string');
  if (memberIds.length === 0 || !memberIds.includes(value.ownerId)) return undefined;
  const createdAt = Number(value.createdAt);
  if (!Number.isFinite(createdAt)) return undefined;
  const nameKey = typeof value.nameKey === 'string' ? value.nameKey : clanNameKey(value.name);
  return {
    clanId: value.clanId,
    name: value.name,
    nameKey,
    icon: value.icon,
    ownerId: value.ownerId,
    memberIds: [...new Set(memberIds)],
    createdAt,
  };
}

function parseInvitation(value: unknown): ClanInvitation | undefined {
  if (!isRecord(value) || typeof value.invitationId !== 'string' || typeof value.clanId !== 'string') return undefined;
  if (typeof value.fromPlayerId !== 'string' || typeof value.toPlayerId !== 'string') return undefined;
  const createdAt = Number(value.createdAt);
  const expiresAt = Number(value.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return undefined;
  return {
    invitationId: value.invitationId,
    clanId: value.clanId,
    fromPlayerId: value.fromPlayerId,
    toPlayerId: value.toPlayerId,
    createdAt,
    expiresAt,
  };
}

function parseRequest(value: unknown): ClanJoinRequest | undefined {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.clanId !== 'string') return undefined;
  if (typeof value.playerId !== 'string') return undefined;
  const createdAt = Number(value.createdAt);
  const expiresAt = Number(value.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return undefined;
  return {
    requestId: value.requestId,
    clanId: value.clanId,
    playerId: value.playerId,
    createdAt,
    expiresAt,
  };
}

function coinLabel(amount: number): string {
  return formatCompactMegacoins(amount);
}

export class ClanService {
  private clans = new Map<string, ClanRecord>();
  private invitations = new Map<string, ClanInvitation>();
  private requests = new Map<string, ClanJoinRequest>();
  private nextClanId = 1;
  private nextInvitationId = 1;
  private nextRequestId = 1;
  private readonly sessions = new Map<string, ClanSession>();
  private readonly locks = new Set<string>();
  private runtime: ClanRuntime = emptyRuntime();

  constructor(
    private readonly store: JsonFileStore,
    private readonly economy: EconomyService,
    private readonly now: () => number = Date.now,
    private readonly createPolicy: ClanCreatePolicy = defaultClanCreatePolicy,
  ) {
    this.load();
  }

  setRuntime(runtime: ClanRuntime): void {
    this.runtime = runtime;
  }

  load(): void {
    const file = this.store.load<ClanFile>('clans/clans', {
      nextClanId: 1,
      nextInvitationId: 1,
      nextRequestId: 1,
      clans: [],
      invitations: [],
      requests: [],
    });
    this.nextClanId = Number.isInteger(file.nextClanId) && file.nextClanId > 0 ? file.nextClanId : 1;
    this.nextInvitationId = Number.isInteger(file.nextInvitationId) && file.nextInvitationId > 0 ? file.nextInvitationId : 1;
    this.nextRequestId = Number.isInteger(file.nextRequestId) && file.nextRequestId > 0 ? file.nextRequestId : 1;
    this.clans.clear();
    this.invitations.clear();
    this.requests.clear();
    for (const entry of Array.isArray(file.clans) ? file.clans : []) {
      const clan = parseClan(entry);
      if (clan) this.clans.set(clan.clanId, clan);
    }
    for (const entry of Array.isArray(file.invitations) ? file.invitations : []) {
      const invitation = parseInvitation(entry);
      if (invitation) this.invitations.set(invitation.invitationId, invitation);
    }
    for (const entry of Array.isArray(file.requests) ? file.requests : []) {
      const request = parseRequest(entry);
      if (request) this.requests.set(request.requestId, request);
    }
    this.purgeExpired();
  }

  persist(): void {
    this.store.save('clans/clans', {
      nextClanId: this.nextClanId,
      nextInvitationId: this.nextInvitationId,
      nextRequestId: this.nextRequestId,
      clans: [...this.clans.values()],
      invitations: [...this.invitations.values()],
      requests: [...this.requests.values()],
    });
  }

  purgeExpired(now = this.now()): number {
    let changed = 0;
    for (const [id, invitation] of [...this.invitations.entries()]) {
      if (invitation.expiresAt > now && this.clans.has(invitation.clanId)) continue;
      this.invitations.delete(id);
      changed += 1;
    }
    for (const [id, request] of [...this.requests.entries()]) {
      if (request.expiresAt > now && this.clans.has(request.clanId)) continue;
      this.requests.delete(id);
      changed += 1;
    }
    if (changed) this.persist();
    return changed;
  }

  session(playerId: string): ClanSession {
    const existing = this.sessions.get(playerId);
    if (existing) return existing;
    const created: ClanSession = {
      screen: 'closed',
      search: '',
      page: 1,
      selectedIcon: CLAN_ICON_IDS[0],
      nameText: '',
    };
    this.sessions.set(playerId, created);
    return created;
  }

  closeSession(playerId: string): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    session.screen = 'closed';
    session.message = undefined;
    session.selectedClanId = undefined;
    session.selectedPlayerId = undefined;
    session.selectedInvitationId = undefined;
    session.selectedRequestId = undefined;
    session.selectedMemberId = undefined;
  }

  getClan(clanId: string | undefined): ClanRecord | undefined {
    if (!clanId) return undefined;
    return this.clans.get(clanId);
  }

  playerClan(playerId: string): ClanRecord | undefined {
    for (const clan of this.clans.values()) {
      if (clan.memberIds.includes(playerId)) return clan;
    }
    return undefined;
  }

  clanTotal(clan: ClanRecord): number {
    let total = 0;
    for (const memberId of clan.memberIds) total += this.economy.getBalance(memberId);
    return total;
  }

  playerRequest(playerId: string): ClanJoinRequest | undefined {
    this.purgeExpired();
    for (const request of this.requests.values()) {
      if (request.playerId === playerId) return request;
    }
    return undefined;
  }

  invitationsFor(playerId: string): ClanInvitation[] {
    this.purgeExpired();
    return [...this.invitations.values()].filter((invitation) => invitation.toPlayerId === playerId);
  }

  requestsForClan(clanId: string): ClanJoinRequest[] {
    this.purgeExpired();
    return [...this.requests.values()].filter((request) => request.clanId === clanId);
  }

  ranked(search = ''): Array<{ clan: ClanRecord; total: number; rank: number }> {
    this.purgeExpired();
    const needle = search.trim().toLowerCase();
    const rows = [...this.clans.values()]
      .filter((clan) => !needle || clan.name.toLowerCase().includes(needle))
      .map((clan) => ({ clan, total: this.clanTotal(clan) }));
    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.clan.memberIds.length !== a.clan.memberIds.length) return b.clan.memberIds.length - a.clan.memberIds.length;
      return a.clan.createdAt - b.clan.createdAt;
    });
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }

  openRanking(playerId: string, search?: string): void {
    this.purgeExpired();
    const session = this.session(playerId);
    session.screen = 'ranking';
    if (search !== undefined) session.search = search;
    session.selectedClanId = undefined;
    session.selectedMemberId = undefined;
    session.page = this.clampPage(session.page, this.ranked(session.search).length);
  }

  openCreate(playerId: string): ClanResult {
    this.purgeExpired();
    if (this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_MEMBER_ERROR };
    const gate = this.createPolicy.canCreateClan(playerId);
    if (!gate.ok) return gate;
    const session = this.session(playerId);
    session.screen = 'create';
    session.nameText = session.nameText ?? '';
    session.selectedIcon = session.selectedIcon || CLAN_ICON_IDS[0];
    session.message = undefined;
    return { ok: true };
  }

  openDelete(playerId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
    if (clan.ownerId !== playerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
    const session = this.session(playerId);
    session.screen = 'delete-confirm';
    session.selectedClanId = clan.clanId;
    session.message = undefined;
    return { ok: true, clan };
  }

  openAdd(playerId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
    if (clan.ownerId !== playerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
    const session = this.session(playerId);
    session.screen = 'add';
    session.selectedClanId = clan.clanId;
    session.selectedPlayerId = undefined;
    session.search = '';
    session.page = 1;
    session.message = undefined;
    return { ok: true, clan };
  }

  openAccept(playerId: string): ClanResult {
    if (this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_OTHER_CLAN_ERROR };
    const session = this.session(playerId);
    session.screen = 'accept';
    session.selectedInvitationId = undefined;
    session.message = undefined;
    return { ok: true };
  }

  openLeave(playerId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
    if (clan.ownerId === playerId) return { ok: false, error: CLAN_OWNER_LEAVE_ERROR };
    const session = this.session(playerId);
    session.screen = 'leave-confirm';
    session.selectedClanId = clan.clanId;
    session.message = undefined;
    return { ok: true, clan };
  }

  openMakeLeader(playerId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
    if (clan.ownerId !== playerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
    const session = this.session(playerId);
    session.screen = 'makeleader';
    session.selectedClanId = clan.clanId;
    session.selectedMemberId = undefined;
    session.search = '';
    session.page = 1;
    session.message = undefined;
    return { ok: true, clan };
  }

  openKick(playerId: string, targetId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
    if (clan.ownerId !== playerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
    if (targetId === playerId) return { ok: false, error: CLAN_KICK_SELF_ERROR };
    if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
    const session = this.session(playerId);
    session.screen = 'kick-confirm';
    session.selectedClanId = clan.clanId;
    session.selectedMemberId = targetId;
    session.message = undefined;
    return { ok: true, clan };
  }

  createClan(playerId: string, rawName: string | undefined, icon: string | undefined): ClanResult {
    const parsed = validateClanName(rawName);
    const key = parsed.ok ? clanNameKey(parsed.name) : '';
    return this.withLocks([`player:${playerId}`, key ? `name:${key}` : ''], () => {
      const gate = this.createPolicy.canCreateClan(playerId);
      if (!gate.ok) return gate;
      if (this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_MEMBER_ERROR };
      if (!parsed.ok) return parsed;
      if (!isClanIconId(icon)) return { ok: false, error: CLAN_ICON_ERROR };
      for (const clan of this.clans.values()) {
        if (clan.nameKey === key) return { ok: false, error: CLAN_NAME_TAKEN_ERROR };
      }
      const paid = this.economy.withdraw(playerId, CLAN_CREATE_COST, 'CLAN_CREATE');
      if (!paid.ok) return { ok: false, error: paid.error ?? 'Недостаточно Мегакоинов.' };
      const clan: ClanRecord = {
        clanId: `clan-${this.nextClanId++}`,
        name: parsed.name,
        nameKey: key,
        icon,
        ownerId: playerId,
        memberIds: [playerId],
        createdAt: this.now(),
      };
      this.clans.set(clan.clanId, clan);
      this.clearPlayerPending(playerId);
      this.persist();
      const session = this.session(playerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.message = `Клан ${clan.name} создан.`;
      return { ok: true, clan };
    });
  }

  deleteClan(playerId: string, clanId?: string): ClanResult {
    return this.withLocks([`player:${playerId}`, clanId ? `clan:${clanId}` : ''], () => {
      const clan = this.getClan(clanId) ?? this.playerClan(playerId);
      if (!clan) return { ok: false, error: clanId ? CLAN_MISSING_ERROR : CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId !== playerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      this.clans.delete(clan.clanId);
      for (const [id, invitation] of [...this.invitations.entries()]) {
        if (invitation.clanId === clan.clanId) this.invitations.delete(id);
      }
      for (const [id, request] of [...this.requests.entries()]) {
        if (request.clanId === clan.clanId) this.requests.delete(id);
      }
      this.persist();
      this.closeSession(playerId);
      const session = this.session(playerId);
      session.screen = 'ranking';
      session.message = `Клан ${clan.name} удалён.`;
      return { ok: true, clan };
    });
  }

  invitePlayer(ownerId: string, targetId: string): ClanResult {
    const owned = this.playerClan(ownerId);
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`, owned ? `clan:${owned.clanId}` : ''], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId !== ownerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      if (targetId === ownerId) return { ok: false, error: CLAN_INVITE_SELF_ERROR };
      if (!this.runtime.isOnline(targetId)) return { ok: false, error: CLAN_OFFLINE_INVITE_ERROR };
      if (this.playerClan(targetId)) return { ok: false, error: CLAN_TARGET_IN_CLAN_ERROR };
      if (clan.memberIds.length >= CLAN_MAX_MEMBERS) return { ok: false, error: CLAN_FULL_ERROR };
      const existing = [...this.invitations.values()].find(
        (invitation) => invitation.clanId === clan.clanId && invitation.toPlayerId === targetId,
      );
      if (existing && existing.expiresAt > this.now()) {
        const session = this.session(ownerId);
        session.screen = 'add';
        session.message = 'Приглашение уже отправлено.';
        return { ok: true, clan };
      }
      const now = this.now();
      const invitation: ClanInvitation = {
        invitationId: `cinv-${this.nextInvitationId++}`,
        clanId: clan.clanId,
        fromPlayerId: ownerId,
        toPlayerId: targetId,
        createdAt: now,
        expiresAt: now + CLAN_INVITE_TTL_MS,
      };
      this.invitations.set(invitation.invitationId, invitation);
      this.persist();
      const session = this.session(ownerId);
      session.screen = 'add';
      session.selectedPlayerId = undefined;
      session.message = `Приглашение отправлено игроку ${this.runtime.displayName(targetId)}.`;
      return { ok: true, clan };
    });
  }

  acceptInvitation(playerId: string, invitationId: string): ClanResult {
    const preview = this.invitations.get(invitationId);
    return this.withLocks([`player:${playerId}`, preview ? `clan:${preview.clanId}` : '', `invite:${invitationId}`], () => {
      this.purgeExpired();
      if (this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_OTHER_CLAN_ERROR };
      const invitation = this.invitations.get(invitationId);
      if (!invitation || invitation.toPlayerId !== playerId || invitation.expiresAt <= this.now()) {
        return { ok: false, error: CLAN_INVITE_MISSING_ERROR };
      }
      const clan = this.clans.get(invitation.clanId);
      if (!clan) return { ok: false, error: CLAN_MISSING_ERROR };
      if (clan.ownerId !== invitation.fromPlayerId) return { ok: false, error: CLAN_INVITE_MISSING_ERROR };
      if (clan.memberIds.length >= CLAN_MAX_MEMBERS) return { ok: false, error: CLAN_FULL_ERROR };
      clan.memberIds = [...clan.memberIds, playerId];
      this.clearPlayerPending(playerId);
      this.persist();
      const session = this.session(playerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.message = `Вы вступили в клан ${clan.name}.`;
      return { ok: true, clan };
    });
  }

  leaveClan(playerId: string): ClanResult {
    return this.withLocks([`player:${playerId}`], () => {
      const clan = this.playerClan(playerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId === playerId) return { ok: false, error: CLAN_OWNER_LEAVE_ERROR };
      clan.memberIds = clan.memberIds.filter((id) => id !== playerId);
      this.persist();
      const session = this.session(playerId);
      session.screen = 'ranking';
      session.selectedClanId = undefined;
      session.message = `Вы покинули клан ${clan.name}.`;
      return { ok: true, clan };
    });
  }

  makeLeader(ownerId: string, targetId: string): ClanResult {
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId !== ownerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      if (targetId === ownerId) return { ok: false, error: CLAN_LEADER_SELF_ERROR };
      if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
      clan.ownerId = targetId;
      this.persist();
      const session = this.session(ownerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.selectedMemberId = undefined;
      session.message = `${this.runtime.displayName(targetId)} теперь владелец клана ${clan.name}.`;
      return { ok: true, clan };
    });
  }

  kickMember(ownerId: string, targetId: string): ClanResult {
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId !== ownerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      if (targetId === ownerId) return { ok: false, error: CLAN_KICK_SELF_ERROR };
      if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
      clan.memberIds = clan.memberIds.filter((id) => id !== targetId);
      this.persist();
      const kicked = this.session(targetId);
      if (kicked.screen !== 'closed') {
        kicked.screen = 'ranking';
        kicked.selectedClanId = undefined;
        kicked.message = `Вас исключили из клана ${clan.name}.`;
      }
      const session = this.session(ownerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.selectedMemberId = undefined;
      session.message = `${this.runtime.displayName(targetId)} исключён из клана.`;
      return { ok: true, clan };
    });
  }

  requestJoin(playerId: string, clanId: string, replaceExisting: boolean): ClanResult {
    return this.withLocks([`player:${playerId}`, `clan:${clanId}`], () => {
      this.purgeExpired();
      if (this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_OTHER_CLAN_ERROR };
      const clan = this.clans.get(clanId);
      if (!clan) return { ok: false, error: CLAN_MISSING_ERROR };
      if (clan.memberIds.length >= CLAN_MAX_MEMBERS) return { ok: false, error: CLAN_FULL_ERROR };
      const existing = this.playerRequest(playerId);
      if (existing && existing.clanId === clanId && existing.expiresAt > this.now()) {
        const session = this.session(playerId);
        session.screen = 'card';
        session.selectedClanId = clanId;
        session.message = 'Заявка отправлена';
        return { ok: true, clan };
      }
      if (existing && existing.clanId !== clanId && !replaceExisting) {
        const other = this.clans.get(existing.clanId);
        const session = this.session(playerId);
        session.screen = 'replace-request-confirm';
        session.selectedClanId = clanId;
        session.selectedRequestId = existing.requestId;
        session.message = undefined;
        return { ok: false, error: this.replacePrompt(other?.name ?? 'клан', clan.name), clan };
      }
      if (existing) this.requests.delete(existing.requestId);
      const now = this.now();
      const request: ClanJoinRequest = {
        requestId: `creq-${this.nextRequestId++}`,
        clanId,
        playerId,
        createdAt: now,
        expiresAt: now + CLAN_REQUEST_TTL_MS,
      };
      this.requests.set(request.requestId, request);
      this.persist();
      const session = this.session(playerId);
      session.screen = 'card';
      session.selectedClanId = clanId;
      session.message = 'Заявка отправлена';
      return { ok: true, clan };
    });
  }

  acceptRequest(ownerId: string, requestId: string): ClanResult {
    const preview = this.requests.get(requestId);
    return this.withLocks([
      `player:${ownerId}`,
      preview ? `player:${preview.playerId}` : '',
      preview ? `clan:${preview.clanId}` : '',
      `request:${requestId}`,
    ], () => {
      this.purgeExpired();
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId !== ownerId) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      const request = this.requests.get(requestId);
      if (!request || request.clanId !== clan.clanId || request.expiresAt <= this.now()) {
        return { ok: false, error: CLAN_REQUEST_MISSING_ERROR };
      }
      if (this.playerClan(request.playerId)) return { ok: false, error: CLAN_TARGET_IN_CLAN_ERROR };
      if (clan.memberIds.length >= CLAN_MAX_MEMBERS) return { ok: false, error: CLAN_FULL_ERROR };
      clan.memberIds = [...clan.memberIds, request.playerId];
      this.clearPlayerPending(request.playerId);
      this.persist();
      const session = this.session(ownerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.selectedRequestId = undefined;
      session.message = `${this.runtime.displayName(request.playerId)} принят в клан.`;
      return { ok: true, clan };
    });
  }

  handleAction(playerId: string, message: ClientClanActionMessage): void {
    this.purgeExpired();
    const session = this.session(playerId);
    const previousMessage = session.message;
    session.message = undefined;
    const action = message.action;
    if (action === 'close') {
      this.closeSession(playerId);
      return;
    }
    if (action === 'search') {
      session.search = message.search ?? '';
      session.page = 1;
      return;
    }
    if (action === 'page') {
      session.page = message.page ?? session.page;
      return;
    }
    if (action === 'refresh') {
      return;
    }
    if (action === 'set_name') {
      session.nameText = typeof message.name === 'string' ? message.name.slice(0, CLAN_NAME_MAX) : '';
      if (session.screen !== 'create' && session.screen !== 'create-confirm') session.screen = 'create';
      return;
    }
    if (action === 'select_icon' && isClanIconId(message.icon)) {
      session.selectedIcon = message.icon;
      if (session.screen !== 'create' && session.screen !== 'create-confirm') session.screen = 'create';
      return;
    }
    if (action === 'back') {
      this.goBack(playerId);
      return;
    }
    if (action === 'select_clan' && message.clanId) {
      if (!this.clans.has(message.clanId)) {
        session.message = CLAN_MISSING_ERROR;
        session.screen = 'ranking';
        return;
      }
      session.selectedClanId = message.clanId;
      session.selectedMemberId = undefined;
      session.screen = 'card';
      return;
    }
    if (action === 'create') {
      session.screen = 'create-confirm';
      return;
    }
    if (action === 'cancel_create') {
      session.screen = 'create';
      return;
    }
    if (action === 'confirm_create') {
      const result = this.createClan(playerId, session.nameText, session.selectedIcon);
      if (!result.ok) {
        session.screen = 'create';
        session.message = result.error;
      }
      return;
    }
    if (action === 'confirm_delete') {
      const result = this.deleteClan(playerId, session.selectedClanId);
      if (!result.ok) session.message = result.error;
      return;
    }
    if (action === 'cancel_delete') {
      this.closeSession(playerId);
      return;
    }
    if (action === 'select_player' && message.playerId) {
      session.selectedPlayerId = message.playerId;
      session.screen = session.screen === 'requests' ? 'request-confirm' : 'invite-confirm';
      return;
    }
    if (action === 'confirm_invite') {
      const target = session.selectedPlayerId ?? message.playerId;
      if (!target) {
        session.screen = 'add';
        session.message = 'Выберите игрока.';
        return;
      }
      const result = this.invitePlayer(playerId, target);
      if (!result.ok) {
        session.screen = 'add';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_invite') {
      session.screen = 'add';
      session.selectedPlayerId = undefined;
      return;
    }
    if (action === 'select_invitation' && message.invitationId) {
      session.selectedInvitationId = message.invitationId;
      session.screen = 'accept-confirm';
      return;
    }
    if (action === 'confirm_accept') {
      const invitationId = session.selectedInvitationId ?? message.invitationId;
      if (!invitationId) {
        session.screen = 'accept';
        session.message = CLAN_INVITE_MISSING_ERROR;
        return;
      }
      const result = this.acceptInvitation(playerId, invitationId);
      if (!result.ok) {
        session.screen = 'accept';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_accept') {
      session.screen = 'accept';
      session.selectedInvitationId = undefined;
      return;
    }
    if (action === 'confirm_leave') {
      const result = this.leaveClan(playerId);
      if (!result.ok) session.message = result.error;
      return;
    }
    if (action === 'cancel_leave') {
      this.closeSession(playerId);
      return;
    }
    if (action === 'select_member' && message.playerId) {
      const clan = this.getClan(session.selectedClanId) ?? this.playerClan(playerId);
      if (clan && clan.ownerId === playerId && message.playerId !== playerId && clan.memberIds.includes(message.playerId)) {
        session.selectedMemberId = message.playerId;
        if (session.screen === 'makeleader') session.screen = 'makeleader-confirm';
        else session.screen = 'card';
      }
      return;
    }
    if (action === 'confirm_makeleader') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) {
        session.screen = 'makeleader';
        session.message = 'Выберите участника.';
        return;
      }
      const result = this.makeLeader(playerId, target);
      if (!result.ok) {
        session.screen = 'makeleader';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_makeleader') {
      session.screen = 'makeleader';
      session.selectedMemberId = undefined;
      return;
    }
    if (action === 'kick') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) return;
      session.selectedMemberId = target;
      session.screen = 'kick-confirm';
      return;
    }
    if (action === 'confirm_kick') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) {
        session.screen = 'card';
        return;
      }
      const result = this.kickMember(playerId, target);
      if (!result.ok) {
        session.screen = 'card';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_kick') {
      session.screen = 'card';
      return;
    }
    if (action === 'join' && (message.clanId || session.selectedClanId)) {
      const clanId = message.clanId ?? session.selectedClanId!;
      const existing = this.playerRequest(playerId);
      const clan = this.clans.get(clanId);
      session.selectedClanId = clanId;
      if (existing && clan && existing.clanId !== clanId) {
        session.screen = 'replace-request-confirm';
        session.selectedRequestId = existing.requestId;
        return;
      }
      session.screen = 'join-confirm';
      return;
    }
    if (action === 'confirm_join') {
      const clanId = session.selectedClanId ?? message.clanId;
      if (!clanId) {
        session.screen = 'ranking';
        return;
      }
      const result = this.requestJoin(playerId, clanId, false);
      if (!result.ok && session.screen !== 'replace-request-confirm') {
        if (result.error?.includes('Хотите удалить')) {
          session.screen = 'replace-request-confirm';
        } else {
          session.screen = 'card';
          session.message = result.error;
        }
      }
      return;
    }
    if (action === 'cancel_join') {
      session.screen = 'card';
      return;
    }
    if (action === 'confirm_replace_request') {
      const clanId = session.selectedClanId ?? message.clanId;
      if (!clanId) return;
      const result = this.requestJoin(playerId, clanId, true);
      if (!result.ok) {
        session.screen = 'card';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_replace_request') {
      session.screen = 'card';
      session.message = previousMessage;
      return;
    }
    if (action === 'open_requests') {
      const clan = this.playerClan(playerId);
      if (!clan || clan.ownerId !== playerId) {
        session.message = CLAN_OWNER_ONLY_ERROR;
        return;
      }
      session.screen = 'requests';
      session.selectedClanId = clan.clanId;
      session.selectedRequestId = undefined;
      session.search = '';
      session.page = 1;
      return;
    }
    if (action === 'select_request' && message.requestId) {
      session.selectedRequestId = message.requestId;
      session.screen = 'request-confirm';
      return;
    }
    if (action === 'confirm_accept_request') {
      const requestId = session.selectedRequestId ?? message.requestId;
      if (!requestId) {
        session.screen = 'requests';
        return;
      }
      const result = this.acceptRequest(playerId, requestId);
      if (!result.ok) {
        session.screen = 'requests';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_accept_request') {
      session.screen = 'requests';
      session.selectedRequestId = undefined;
    }
  }

  buildMessage(playerId: string): ServerClanMessage {
    this.purgeExpired();
    const session = this.session(playerId);
    if (session.screen === 'closed') {
      return {
        type: 'clan',
        screen: 'closed',
        title: '',
        search: '',
        page: 1,
        totalPages: 1,
        totalCount: 0,
        clans: [],
      };
    }
    const viewerClan = this.playerClan(playerId);
    const pending = this.playerRequest(playerId);
    const pendingClan = pending ? this.clans.get(pending.clanId) : undefined;
    const base = {
      type: 'clan' as const,
      search: session.search,
      page: session.page,
      viewer: {
        ...(viewerClan ? { clanId: viewerClan.clanId } : {}),
        isOwner: viewerClan?.ownerId === playerId,
        ...(pendingClan ? { pendingRequestClanId: pendingClan.clanId, pendingRequestClanName: pendingClan.name } : {}),
      },
      ...(session.message ? { message: session.message } : {}),
    };

    if (session.screen === 'ranking') {
      const ranked = this.ranked(session.search);
      const paged = this.paginate(ranked, session);
      return {
        ...base,
        screen: 'ranking',
        title: 'Кланы',
        page: session.page,
        totalPages: paged.totalPages,
        totalCount: ranked.length,
        clans: paged.items.map((row) => this.toRow(row.clan, row.total, row.rank)),
      };
    }

    if (session.screen === 'create' || session.screen === 'create-confirm') {
      return {
        ...base,
        screen: session.screen,
        title: 'Создание клана',
        totalPages: 1,
        totalCount: 0,
        clans: [],
        create: {
          nameText: session.nameText,
          icon: session.selectedIcon,
          cost: CLAN_CREATE_COST,
          costLabel: `${formatCompactMegacoins(CLAN_CREATE_COST)} МК`,
        },
        selected: session.screen === 'create-confirm'
          ? { prompt: 'Вы уверены, что хотите создать клан? Это стоит 10 000 Мегакоинов.' }
          : undefined,
      };
    }

    if (session.screen === 'delete-confirm') {
      const clan = this.getClan(session.selectedClanId) ?? viewerClan;
      return {
        ...base,
        screen: 'delete-confirm',
        title: 'Удаление клана',
        totalPages: 1,
        totalCount: 0,
        clans: clan ? [this.toRow(clan, this.clanTotal(clan), 0)] : [],
        selected: {
          clanId: clan?.clanId,
          clanName: clan?.name,
          prompt: 'Вы уверены, что хотите удалить клан?\nЭто нельзя будет отменить.',
        },
      };
    }

    if (session.screen === 'add' || session.screen === 'invite-confirm') {
      const clan = this.getClan(session.selectedClanId) ?? viewerClan;
      const players = this.inviteCandidates(playerId, session.search);
      const paged = this.paginate(players, session);
      const selected = players.find((row) => row.playerId === session.selectedPlayerId);
      return {
        ...base,
        screen: session.screen,
        title: 'Пригласить игрока',
        page: session.page,
        totalPages: paged.totalPages,
        totalCount: players.length,
        clans: [],
        players: paged.items,
        selected: session.screen === 'invite-confirm'
          ? {
            playerId: selected?.playerId,
            playerName: selected?.name,
            prompt: `Вы уверены, что хотите пригласить ${selected?.name ?? 'игрока'} в ваш клан?`,
          }
          : undefined,
        card: clan ? this.cardPayload(playerId, clan, session.selectedMemberId) : undefined,
      };
    }

    if (session.screen === 'accept' || session.screen === 'accept-confirm') {
      const invitations = this.invitationRows(playerId);
      const selected = invitations.find((row) => row.invitationId === session.selectedInvitationId);
      return {
        ...base,
        screen: session.screen,
        title: 'Приглашения',
        totalPages: 1,
        totalCount: invitations.length,
        clans: [],
        invitations,
        selected: session.screen === 'accept-confirm' && selected
          ? {
            invitationId: selected.invitationId,
            clanId: selected.clanId,
            clanName: selected.clanName,
            prompt: `${selected.ownerName} клана пригласил вас в клан ${selected.clanName}. Вы хотите вступить?`,
          }
          : undefined,
      };
    }

    if (session.screen === 'leave-confirm') {
      const clan = viewerClan;
      return {
        ...base,
        screen: 'leave-confirm',
        title: 'Покинуть клан',
        totalPages: 1,
        totalCount: 0,
        clans: clan ? [this.toRow(clan, this.clanTotal(clan), 0)] : [],
        selected: {
          clanId: clan?.clanId,
          clanName: clan?.name,
          prompt: `Вы уверены, что хотите покинуть клан ${clan?.name ?? ''}?`,
        },
      };
    }

    if (session.screen === 'makeleader' || session.screen === 'makeleader-confirm') {
      const clan = viewerClan;
      const members = clan ? this.memberRows(clan).filter((row) => !row.isOwner) : [];
      const selected = members.find((row) => row.playerId === session.selectedMemberId);
      return {
        ...base,
        screen: session.screen,
        title: 'Передать лидерство',
        totalPages: 1,
        totalCount: members.length,
        clans: [],
        members,
        selected: session.screen === 'makeleader-confirm' && selected && clan
          ? {
            playerId: selected.playerId,
            playerName: selected.name,
            clanName: clan.name,
            prompt: `Вы уверены, что хотите сделать игрока ${selected.name} лидером вашего клана ${clan.name}?\n\nВы больше не будете являться владельцем клана.\nЭто действие нельзя отменить.`,
          }
          : undefined,
      };
    }

    if (session.screen === 'kick-confirm') {
      const clan = viewerClan;
      const target = clan ? this.memberRows(clan).find((row) => row.playerId === session.selectedMemberId) : undefined;
      return {
        ...base,
        screen: 'kick-confirm',
        title: 'Исключить игрока',
        totalPages: 1,
        totalCount: 0,
        clans: [],
        selected: {
          playerId: target?.playerId,
          playerName: target?.name,
          prompt: `Вы уверены, что хотите выгнать игрока ${target?.name ?? ''} из вашего клана?`,
        },
        card: clan ? this.cardPayload(playerId, clan, session.selectedMemberId) : undefined,
      };
    }

    if (session.screen === 'requests' || session.screen === 'request-confirm') {
      const clan = viewerClan;
      const requests = clan ? this.requestRows(clan.clanId) : [];
      const paged = this.paginate(requests, session);
      const selected = requests.find((row) => row.playerId === this.requests.get(session.selectedRequestId ?? '')?.playerId)
        ?? requests.find((row) => row.requestId === session.selectedRequestId);
      return {
        ...base,
        screen: session.screen,
        title: 'Запросы на вступление',
        page: session.page,
        totalPages: paged.totalPages,
        totalCount: requests.length,
        clans: [],
        requests: paged.items,
        selected: session.screen === 'request-confirm'
          ? {
            requestId: session.selectedRequestId,
            playerId: selected?.playerId,
            playerName: selected?.name,
            prompt: `Вы уверены, что хотите добавить в клан ${selected?.name ?? 'игрока'}?`,
          }
          : undefined,
      };
    }

    const clan = this.getClan(session.selectedClanId) ?? viewerClan;
    if (!clan) {
      session.screen = 'ranking';
      return this.buildMessage(playerId);
    }
    const other = pendingClan && pendingClan.clanId !== clan.clanId ? pendingClan : undefined;
    return {
      ...base,
      screen: session.screen === 'join-confirm' || session.screen === 'replace-request-confirm' || session.screen === 'card'
        ? session.screen
        : 'card',
      title: clan.name,
      totalPages: 1,
      totalCount: clan.memberIds.length,
      clans: [this.toRow(clan, this.clanTotal(clan), this.rankOf(clan.clanId))],
      members: this.memberRows(clan),
      card: this.cardPayload(playerId, clan, session.selectedMemberId),
      selected: session.screen === 'join-confirm'
        ? { clanId: clan.clanId, clanName: clan.name, prompt: `Вы уверены, что хотите отправить запрос на вступление в клан ${clan.name}?` }
        : session.screen === 'replace-request-confirm'
          ? {
            clanId: clan.clanId,
            clanName: clan.name,
            prompt: `Вы уже отправили заявку в клан ${other?.name ?? pendingClan?.name ?? ''}.\nХотите удалить ее и отправить заявку в ${clan.name}?`,
          }
          : undefined,
    };
  }

  private goBack(playerId: string): void {
    const session = this.session(playerId);
    switch (session.screen) {
      case 'card':
      case 'create':
      case 'delete-confirm':
      case 'add':
      case 'accept':
      case 'leave-confirm':
      case 'makeleader':
        if (session.screen === 'card') {
          this.openRanking(playerId);
          return;
        }
        this.closeSession(playerId);
        return;
      case 'create-confirm':
        session.screen = 'create';
        return;
      case 'invite-confirm':
        session.screen = 'add';
        session.selectedPlayerId = undefined;
        return;
      case 'accept-confirm':
        session.screen = 'accept';
        session.selectedInvitationId = undefined;
        return;
      case 'makeleader-confirm':
        session.screen = 'makeleader';
        session.selectedMemberId = undefined;
        return;
      case 'kick-confirm':
      case 'join-confirm':
      case 'replace-request-confirm':
        session.screen = 'card';
        return;
      case 'requests':
        session.screen = 'card';
        return;
      case 'request-confirm':
        session.screen = 'requests';
        session.selectedRequestId = undefined;
        return;
      default:
        this.openRanking(playerId);
    }
  }

  private clearPlayerPending(playerId: string): void {
    for (const [id, invitation] of [...this.invitations.entries()]) {
      if (invitation.toPlayerId === playerId) this.invitations.delete(id);
    }
    for (const [id, request] of [...this.requests.entries()]) {
      if (request.playerId === playerId) this.requests.delete(id);
    }
  }

  private replacePrompt(oldName: string, newName: string): string {
    return `Вы уже отправили заявку в клан ${oldName}.\nХотите удалить ее и отправить заявку в ${newName}?`;
  }

  private inviteCandidates(ownerId: string, search: string): NetworkClanPlayerRow[] {
    const needle = search.trim().toLowerCase();
    const rows: NetworkClanPlayerRow[] = [];
    for (const player of this.runtime.onlinePlayers()) {
      if (player.id === ownerId) continue;
      if (this.playerClan(player.id)) continue;
      if (needle && !player.name.toLowerCase().includes(needle)) continue;
      const balance = this.economy.getBalance(player.id);
      rows.push({
        playerId: player.id,
        name: player.name,
        balance,
        balanceLabel: coinLabel(balance),
      });
    }
    rows.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ru'));
    return rows;
  }

  private memberRows(clan: ClanRecord): NetworkClanMember[] {
    const rows = clan.memberIds.map((memberId) => {
      const balance = this.economy.getBalance(memberId);
      return {
        playerId: memberId,
        name: this.runtime.displayName(memberId),
        balance,
        balanceLabel: coinLabel(balance),
        isOwner: memberId === clan.ownerId,
      };
    });
    rows.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return b.balance - a.balance || a.name.localeCompare(b.name, 'ru');
    });
    return rows;
  }

  private requestRows(clanId: string): Array<NetworkClanPlayerRow & { requestId: string }> {
    return this.requestsForClan(clanId).map((request) => {
      const balance = this.economy.getBalance(request.playerId);
      return {
        requestId: request.requestId,
        playerId: request.playerId,
        name: this.runtime.displayName(request.playerId),
        balance,
        balanceLabel: coinLabel(balance),
      };
    }).sort((a, b) => b.balance - a.balance);
  }

  private invitationRows(playerId: string): NetworkClanInvitation[] {
    const rows: NetworkClanInvitation[] = [];
    for (const invitation of this.invitationsFor(playerId)) {
      const clan = this.clans.get(invitation.clanId);
      if (!clan) continue;
      rows.push({
        invitationId: invitation.invitationId,
        clanId: clan.clanId,
        clanName: clan.name,
        icon: clan.icon,
        ownerName: this.runtime.displayName(clan.ownerId),
        expiresAt: invitation.expiresAt,
      });
    }
    return rows;
  }

  private toRow(clan: ClanRecord, total: number, rank: number): NetworkClanRow {
    return {
      clanId: clan.clanId,
      name: clan.name,
      icon: clan.icon,
      rank,
      totalBalance: total,
      totalLabel: coinLabel(total),
      memberCount: clan.memberIds.length,
      createdAt: clan.createdAt,
    };
  }

  private rankOf(clanId: string): number {
    return this.ranked().find((row) => row.clan.clanId === clanId)?.rank ?? 0;
  }

  private cardPayload(playerId: string, clan: ClanRecord, selectedMemberId: string | undefined): NonNullable<ServerClanMessage['card']> {
    const own = this.playerClan(playerId);
    const pending = this.playerRequest(playerId);
    const isOwner = clan.ownerId === playerId;
    const isMember = clan.memberIds.includes(playerId);
    const isFull = clan.memberIds.length >= CLAN_MAX_MEMBERS;
    let joinState: NonNullable<ServerClanMessage['card']>['joinState'] = 'none';
    let joinLabel: string | undefined;
    if (isMember) joinState = 'own';
    else if (own) {
      joinState = 'other-clan';
      joinLabel = 'Вы уже состоите в другом клане.';
    } else if (isFull) {
      joinState = 'full';
      joinLabel = CLAN_FULL_ERROR;
    } else if (pending?.clanId === clan.clanId) {
      joinState = 'sent';
      joinLabel = 'Заявка отправлена';
    }
    const canKick = isOwner && !!selectedMemberId && selectedMemberId !== playerId && clan.memberIds.includes(selectedMemberId);
    return {
      clanId: clan.clanId,
      name: clan.name,
      icon: clan.icon,
      totalBalance: this.clanTotal(clan),
      totalLabel: coinLabel(this.clanTotal(clan)),
      memberCount: clan.memberIds.length,
      ownerId: clan.ownerId,
      ownerName: this.runtime.displayName(clan.ownerId),
      isOwner,
      isMember,
      isFull,
      joinState,
      ...(joinLabel ? { joinLabel } : {}),
      ...(selectedMemberId ? { selectedMemberId } : {}),
      canKickSelected: canKick,
    };
  }

  private paginate<T>(items: readonly T[], session: ClanSession): { items: T[]; totalPages: number } {
    const totalPages = Math.max(1, Math.ceil(items.length / CLAN_PAGE_SIZE) || 1);
    session.page = this.clampPage(session.page, items.length);
    const start = (session.page - 1) * CLAN_PAGE_SIZE;
    return { items: items.slice(start, start + CLAN_PAGE_SIZE) as T[], totalPages };
  }

  private clampPage(page: number, totalCount: number): number {
    const totalPages = Math.max(1, Math.ceil(totalCount / CLAN_PAGE_SIZE) || 1);
    if (!Number.isFinite(page)) return 1;
    return Math.max(1, Math.min(totalPages, Math.trunc(page)));
  }

  private withLocks(keys: readonly string[], fn: () => ClanResult): ClanResult {
    const unique = [...new Set(keys.filter(Boolean))].sort();
    for (const key of unique) {
      if (this.locks.has(key)) return { ok: false, error: CLAN_BUSY_ERROR };
    }
    for (const key of unique) this.locks.add(key);
    try {
      return fn();
    } finally {
      for (const key of unique) this.locks.delete(key);
    }
  }
}
