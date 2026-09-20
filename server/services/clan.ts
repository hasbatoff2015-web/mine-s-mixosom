import type {
  ClientClanActionMessage,
  ServerClanMessage,
  NetworkClanInvitation,
  NetworkClanMember,
  NetworkClanPlayerRow,
  NetworkClanRow,
} from '../../shared/protocol';
import {
  CLAN_ALREADY_IN_OTHER_CLAN_ERROR,
  CLAN_ALREADY_IN_THIS_CLAN_ERROR,
  CLAN_ANNOUNCEMENT_COOLDOWN_MS,
  CLAN_ANNOUNCE_EMPTY_ERROR,
  CLAN_BASE_ABSENT_LABEL,
  CLAN_BASE_ALREADY_HERE_ERROR,
  CLAN_BASE_ANCHOR_ERROR,
  CLAN_BASE_CHANGED_MESSAGE,
  CLAN_BASE_CHANGE_LABEL,
  clanBaseConfirmPrompt,
  CLAN_BASE_COOLDOWN_MS,
  CLAN_BASE_MISSING_ERROR,
  CLAN_BASE_OVERLAP_ERROR,
  CLAN_BASE_POSITION_ERROR,
  CLAN_BASE_PRESENT_LABEL,
  CLAN_BASE_SET_LABEL,
  CLAN_BASE_SET_MESSAGE,
  CLAN_BASE_TELEPORT_MESSAGE,
  CLAN_BASE_WORLD_ERROR,
  CLAN_CREATE_COST,
  CLAN_DEMOTE_VETERAN_ONLY_ERROR,
  CLAN_ICON_IDS,
  CLAN_INVITE_EMPTY_ERROR,
  CLAN_INVITE_EXISTS_ERROR,
  CLAN_INVITE_SENT_MESSAGE,
  CLAN_INVITE_TTL_MS,
  CLAN_KICK_DENIED_ERROR,
  CLAN_MAX_MEMBERS,
  CLAN_NAME_MAX,
  CLAN_NO_VETERAN_ERROR,
  CLAN_PAGE_SIZE,
  CLAN_PLAYER_NOT_FOUND_ERROR,
  CLAN_PLUGIN_NAME,
  CLAN_PROMOTE_MEMBER_ONLY_ERROR,
  CLAN_REQUEST_TTL_MS,
  CLAN_TRANSFER_VETERAN_ONLY_ERROR,
  canClanAnnounce,
  canClanInvite,
  canClanKick,
  canClanManageVeterans,
  canClanSetBase,
  canClanTransferLeader,
  clanAnnounceCooldownLabel,
  clanAnnouncementChat,
  clanBaseCooldownLabel,
  clanInviteChat,
  clanNameKey,
  clanRoleLabel,
  defaultClanCreatePolicy,
  formatRemainingDuration,
  isClanIconId,
  isClanRole,
  validateClanName,
  type ClanCreatePolicy,
  type ClanIconId,
  type ClanRole,
} from '../../shared/clans';
import { CHAT_TOO_LONG_ERROR, normalizeOutgoingChatText } from '../../shared/chat';
import { MAX_CHAT_LENGTH } from '../../shared/config';
import { formatCompactMegacoins } from '../../shared/megacoins';
import { formatKillsLabel, isClanMemberSort, type ClanMemberSort } from '../../shared/ranking';
import { BlockId } from '../../src/blocks';
import type { EconomyService } from './economy';
import type { JsonFileStore } from './jsonStore';
import { overlappingClaims } from './claimAnchors';
import type { Claim, ClaimStore } from './claims';
import {
  clanBaseTeleportDest,
  createClanBaseClaim,
  resolveClanBaseAnchor,
} from './clanBase';

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
export {
  CLAN_PLAYER_NOT_FOUND_ERROR,
  CLAN_ALREADY_IN_THIS_CLAN_ERROR,
  CLAN_ALREADY_IN_OTHER_CLAN_ERROR,
  CLAN_INVITE_EXISTS_ERROR,
  CLAN_INVITE_SENT_MESSAGE,
  CLAN_TRANSFER_VETERAN_ONLY_ERROR,
};

export type ClanView =
  | 'ranking'
  | 'create'
  | 'delete'
  | 'add'
  | 'accept'
  | 'leave'
  | 'makeleader'
  | 'kick'
  | 'mine';

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
  | 'member-card'
  | 'transfer-confirm'
  | 'announce'
  | 'set-base-confirm'
  | 'closed';

export interface ClanBase {
  worldId: string;
  x: number;
  y: number;
  z: number;
  claimId: string;
}

export interface ClanRecord {
  clanId: string;
  name: string;
  nameKey: string;
  icon: ClanIconId;
  ownerId: string;
  memberIds: string[];
  roles: Record<string, ClanRole>;
  createdAt: number;
  announcementCooldownUntil?: number;
  base?: ClanBase;
  baseCooldownUntil?: number;
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
  sendMessage(playerId: string, text: string, extra?: { channel?: 'global' | 'nearby' | 'clan'; style?: 'announcement' }): void;
  lookupPlayer?(idOrName: string): { id: string; name: string; connected: boolean } | undefined;
  friendRelation?(viewerId: string, targetId: string): 'self' | 'friend' | 'outgoing' | 'none';
  requestFriend?(fromId: string, targetId: string): { ok: boolean; error?: string };
  cancelFriendRequest?(fromId: string, targetId: string): { ok: boolean; error?: string };
  notifyUnread?(playerId: string, category: 'clans'): void;
  playerPosition?(playerId: string): { x: number; y: number; z: number } | undefined;
  worldId?(): string;
  getBlock?(x: number, y: number, z: number): number;
  setBlock?(x: number, y: number, z: number, blockId: number): boolean;
  loadClaims?(): ClaimStore;
  saveClaims?(store: ClaimStore): void;
  teleportNow?(playerId: string, dest: { x: number; y: number; z: number }): { ok: boolean; error?: string };
  showClaim?(playerId: string, claim: Claim): void;
}

export interface ClanSession {
  screen: ClanScreen;
  search: string;
  page: number;
  selectedClanId?: string;
  openedFromMenu?: boolean;
  menuEntry?: 'ranking' | 'create' | 'mine' | 'accept';
  selectedIcon: ClanIconId;
  nameText: string;
  inviteName: string;
  inviteMessage?: string;
  announceText: string;
  memberSort: ClanMemberSort;
  rankingSort: ClanMemberSort;
  selectedPlayerId?: string;
  selectedInvitationId?: string;
  selectedRequestId?: string;
  selectedMemberId?: string;
  acceptFromCard?: boolean;
  transferFromCard?: boolean;
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

export { clanInviteChat, clanAnnouncementChat };

function emptyRuntime(): ClanRuntime {
  return {
    onlinePlayers: () => [],
    isOnline: () => false,
    displayName: (id) => id.slice(0, 8),
    sendMessage: () => {},
  };
}

function parseClan(value: unknown): ClanRecord | undefined {
  if (!isRecord(value) || typeof value.clanId !== 'string' || typeof value.name !== 'string') return undefined;
  if (typeof value.ownerId !== 'string' || typeof value.icon !== 'string' || !isClanIconId(value.icon)) return undefined;
  if (!Array.isArray(value.memberIds)) return undefined;
  const memberIds = [...new Set(value.memberIds.filter((id): id is string => typeof id === 'string'))];
  if (memberIds.length === 0 || !memberIds.includes(value.ownerId)) return undefined;
  const createdAt = Number(value.createdAt);
  if (!Number.isFinite(createdAt)) return undefined;
  const nameKey = typeof value.nameKey === 'string' ? value.nameKey : clanNameKey(value.name);
  const rawRoles = isRecord(value.roles) ? value.roles : {};
  const roles: Record<string, ClanRole> = {};
  for (const memberId of memberIds) {
    if (memberId === value.ownerId) roles[memberId] = 'leader';
    else if (isClanRole(typeof rawRoles[memberId] === 'string' ? rawRoles[memberId] as string : undefined)
      && rawRoles[memberId] === 'veteran') roles[memberId] = 'veteran';
    else roles[memberId] = 'member';
  }
  const cooldownRaw = Number(value.announcementCooldownUntil);
  const announcementCooldownUntil = Number.isFinite(cooldownRaw) && cooldownRaw > 0 ? cooldownRaw : undefined;
  const baseCooldownRaw = Number(value.baseCooldownUntil);
  const baseCooldownUntil = Number.isFinite(baseCooldownRaw) && baseCooldownRaw > 0 ? baseCooldownRaw : undefined;
  const base = parseClanBase(value.base);
  return {
    clanId: value.clanId,
    name: value.name,
    nameKey,
    icon: value.icon,
    ownerId: value.ownerId,
    memberIds,
    roles,
    createdAt,
    ...(announcementCooldownUntil ? { announcementCooldownUntil } : {}),
    ...(base ? { base } : {}),
    ...(baseCooldownUntil ? { baseCooldownUntil } : {}),
  };
}

function parseClanBase(value: unknown): ClanBase | undefined {
  if (!isRecord(value) || typeof value.worldId !== 'string' || typeof value.claimId !== 'string') return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return undefined;
  return { worldId: value.worldId, x, y, z, claimId: value.claimId };
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

  purgeExpired(now = this.now()): ClanInvitation[] {
    const removed: ClanInvitation[] = [];
    for (const [id, invitation] of [...this.invitations.entries()]) {
      if (invitation.expiresAt > now && this.clans.has(invitation.clanId)) continue;
      this.invitations.delete(id);
      removed.push(invitation);
    }
    let requestChanged = false;
    for (const [id, request] of [...this.requests.entries()]) {
      if (request.expiresAt > now && this.clans.has(request.clanId)) continue;
      this.requests.delete(id);
      requestChanged = true;
    }
    if (removed.length || requestChanged) this.persist();
    return removed;
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
      inviteName: '',
      announceText: '',
      memberSort: 'money',
      rankingSort: 'money',
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
    session.openedFromMenu = undefined;
    session.menuEntry = undefined;
    session.inviteName = '';
    session.inviteMessage = undefined;
    session.announceText = '';
    session.memberSort = 'money';
    session.rankingSort = 'money';
    session.transferFromCard = undefined;
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

  private invitationFor(playerId: string, clanId: string): ClanInvitation | undefined {
    this.purgeExpired();
    for (const invitation of this.invitations.values()) {
      if (invitation.toPlayerId === playerId && invitation.clanId === clanId) return invitation;
    }
    return undefined;
  }

  private clearCreateDraft(playerId: string): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    session.nameText = '';
    session.selectedIcon = CLAN_ICON_IDS[0];
    session.acceptFromCard = false;
  }

  /** Drop a player from every clan they do not own. Source of truth is memberIds. */
  private detachFromClans(playerId: string): void {
    for (const clan of this.clans.values()) {
      if (clan.ownerId === playerId) continue;
      if (!clan.memberIds.includes(playerId)) continue;
      clan.memberIds = clan.memberIds.filter((id) => id !== playerId);
      delete clan.roles[playerId];
    }
    this.clearCreateDraft(playerId);
  }

  clanKills(clan: ClanRecord): number {
    let total = 0;
    for (const memberId of clan.memberIds) total += this.economy.getKills(memberId);
    return total;
  }

  roleOf(clan: ClanRecord, playerId: string): ClanRole {
    if (playerId === clan.ownerId) return 'leader';
    const stored = clan.roles[playerId];
    return stored === 'veteran' ? 'veteran' : 'member';
  }

  private syncRoles(clan: ClanRecord): void {
    const next: Record<string, ClanRole> = {};
    for (const memberId of clan.memberIds) {
      next[memberId] = memberId === clan.ownerId ? 'leader' : clan.roles[memberId] === 'veteran' ? 'veteran' : 'member';
    }
    clan.roles = next;
  }

  private lookupTarget(raw: string): { id: string; name: string; connected: boolean } | undefined {
    const needle = raw.trim();
    if (!needle) return undefined;
    if (this.runtime.lookupPlayer) return this.runtime.lookupPlayer(needle);
    const lower = needle.toLowerCase();
    for (const player of this.runtime.onlinePlayers()) {
      if (player.id === needle || player.name.toLowerCase() === lower) {
        return { id: player.id, name: player.name, connected: true };
      }
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

  ranked(search = '', sort: ClanMemberSort = 'money'): Array<{ clan: ClanRecord; total: number; kills: number; rank: number }> {
    this.purgeExpired();
    const needle = search.trim().toLowerCase();
    const rows = [...this.clans.values()]
      .filter((clan) => !needle || clan.name.toLowerCase().includes(needle))
      .map((clan) => ({ clan, total: this.clanTotal(clan), kills: this.clanKills(clan) }));
    rows.sort((a, b) => {
      if (sort === 'kills') {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.clan.name.localeCompare(b.clan.name, 'ru', { sensitivity: 'base' });
      }
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
    session.page = this.clampPage(session.page, this.ranked(session.search, session.rankingSort).length);
  }

  openMyClan(playerId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: 'Вы не состоите в клане.' };
    const session = this.session(playerId);
    session.selectedClanId = clan.clanId;
    session.selectedMemberId = undefined;
    session.screen = 'card';
    session.message = undefined;
    return { ok: true, clan };
  }

  markOpenedFromMenu(playerId: string, view?: 'ranking' | 'create' | 'mine' | 'accept'): void {
    const session = this.session(playerId);
    session.openedFromMenu = true;
    if (view) session.menuEntry = view;
  }

  openCreate(playerId: string): ClanResult {
    this.purgeExpired();
    if (this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_MEMBER_ERROR };
    const gate = this.createPolicy.canCreateClan(playerId);
    if (!gate.ok) return gate;
    const session = this.session(playerId);
    const keepDraft = session.screen === 'create' || session.screen === 'create-confirm';
    session.screen = 'create';
    if (!keepDraft) {
      session.nameText = '';
      session.selectedIcon = CLAN_ICON_IDS[0];
    } else {
      session.nameText = session.nameText ?? '';
      session.selectedIcon = session.selectedIcon || CLAN_ICON_IDS[0];
    }
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
    if (!canClanInvite(this.roleOf(clan, playerId))) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
    const session = this.session(playerId);
    session.screen = 'add';
    session.selectedClanId = clan.clanId;
    session.selectedPlayerId = undefined;
    session.search = '';
    session.page = 1;
    session.message = undefined;
    return { ok: true, clan };
  }

  openAccept(playerId: string, options: { allowInClan?: boolean } = {}): ClanResult {
    if (!options.allowInClan && this.playerClan(playerId)) return { ok: false, error: CLAN_ALREADY_OTHER_CLAN_ERROR };
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
    const veterans = clan.memberIds.filter((id) => this.roleOf(clan, id) === 'veteran');
    if (veterans.length === 0) return { ok: false, error: CLAN_NO_VETERAN_ERROR };
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
    if (targetId === playerId) return { ok: false, error: CLAN_KICK_SELF_ERROR };
    if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
    if (!canClanKick(this.roleOf(clan, playerId), this.roleOf(clan, targetId))) {
      return { ok: false, error: CLAN_KICK_DENIED_ERROR };
    }
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
        roles: { [playerId]: 'leader' },
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
      this.removeClanBaseClaim(clan);
      const released = [...clan.memberIds];
      this.clans.delete(clan.clanId);
      for (const [id, invitation] of [...this.invitations.entries()]) {
        if (invitation.clanId === clan.clanId) this.invitations.delete(id);
      }
      for (const [id, request] of [...this.requests.entries()]) {
        if (request.clanId === clan.clanId) this.requests.delete(id);
      }
      this.persist();
      for (const memberId of released) this.clearCreateDraft(memberId);
      this.closeSession(playerId);
      const session = this.session(playerId);
      session.screen = 'ranking';
      session.message = `Клан ${clan.name} удалён.`;
      return { ok: true, clan };
    });
  }

  invitePlayer(ownerId: string, targetId: string, options: { allowOffline?: boolean; keepScreen?: boolean } = {}): ClanResult {
    const owned = this.playerClan(ownerId);
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`, owned ? `clan:${owned.clanId}` : ''], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (!canClanInvite(this.roleOf(clan, ownerId))) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      if (targetId === ownerId) return { ok: false, error: CLAN_INVITE_SELF_ERROR };
      if (!options.allowOffline && !this.runtime.isOnline(targetId)) return { ok: false, error: CLAN_OFFLINE_INVITE_ERROR };
      const targetClan = this.playerClan(targetId);
      if (targetClan?.clanId === clan.clanId) return { ok: false, error: CLAN_ALREADY_IN_THIS_CLAN_ERROR };
      if (targetClan) return { ok: false, error: CLAN_ALREADY_IN_OTHER_CLAN_ERROR };
      if (clan.memberIds.length >= CLAN_MAX_MEMBERS) return { ok: false, error: CLAN_FULL_ERROR };
      const existing = [...this.invitations.values()].find(
        (invitation) => invitation.clanId === clan.clanId && invitation.toPlayerId === targetId,
      );
      if (existing && existing.expiresAt > this.now()) {
        const session = this.session(ownerId);
        if (!options.keepScreen) session.screen = 'add';
        session.inviteMessage = CLAN_INVITE_EXISTS_ERROR;
        session.message = options.keepScreen ? session.message : CLAN_INVITE_EXISTS_ERROR;
        return { ok: false, error: CLAN_INVITE_EXISTS_ERROR, clan };
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
      this.runtime.sendMessage(targetId, clanInviteChat(this.runtime.displayName(ownerId), clan.name));
      this.runtime.notifyUnread?.(targetId, 'clans');
      const session = this.session(ownerId);
      if (!options.keepScreen) {
        session.screen = 'add';
        session.selectedPlayerId = undefined;
        session.message = `Приглашение отправлено игроку ${this.runtime.displayName(targetId)}.`;
      } else {
        session.inviteName = '';
        session.inviteMessage = CLAN_INVITE_SENT_MESSAGE;
      }
      return { ok: true, clan };
    });
  }

  invitePlayerByName(actorId: string, rawName: string | undefined): ClanResult {
    const name = (rawName ?? '').trim();
    const session = this.session(actorId);
    session.inviteName = name.slice(0, 24);
    if (!name) {
      session.inviteMessage = CLAN_INVITE_EMPTY_ERROR;
      return { ok: false, error: CLAN_INVITE_EMPTY_ERROR };
    }
    const target = this.lookupTarget(name);
    if (!target) {
      session.inviteMessage = CLAN_PLAYER_NOT_FOUND_ERROR;
      return { ok: false, error: CLAN_PLAYER_NOT_FOUND_ERROR };
    }
    const result = this.invitePlayer(actorId, target.id, { allowOffline: true, keepScreen: true });
    session.inviteMessage = result.ok ? CLAN_INVITE_SENT_MESSAGE : (result.error ?? 'Не удалось отправить приглашение.');
    return result;
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
      if (clan.memberIds.length >= CLAN_MAX_MEMBERS) return { ok: false, error: CLAN_FULL_ERROR };
      clan.memberIds = [...clan.memberIds, playerId];
      clan.roles[playerId] = 'member';
      this.syncRoles(clan);
      this.clearPlayerPending(playerId);
      this.persist();
      const session = this.session(playerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.message = `Вы вступили в клан ${clan.name}.`;
      return { ok: true, clan };
    });
  }

  rejectInvitation(playerId: string, invitationId: string): ClanResult {
    return this.withLocks([`player:${playerId}`, `invite:${invitationId}`], () => {
      this.purgeExpired();
      const invitation = this.invitations.get(invitationId);
      if (!invitation || invitation.toPlayerId !== playerId) {
        const session = this.session(playerId);
        session.screen = 'accept';
        session.selectedInvitationId = undefined;
        session.message = CLAN_INVITE_MISSING_ERROR;
        return { ok: false, error: CLAN_INVITE_MISSING_ERROR };
      }
      this.invitations.delete(invitationId);
      this.persist();
      const session = this.session(playerId);
      session.screen = 'accept';
      session.selectedInvitationId = undefined;
      session.message = 'Приглашение отклонено.';
      return { ok: true };
    });
  }

  openAnnounce(playerId: string): ClanResult {
    const clan = this.playerClan(playerId);
    if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
    if (!canClanAnnounce(this.roleOf(clan, playerId))) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
    const session = this.session(playerId);
    session.screen = 'announce';
    session.selectedClanId = clan.clanId;
    session.message = undefined;
    return { ok: true, clan };
  }

  sendAnnouncement(playerId: string, rawText: string | undefined): ClanResult {
    const owned = this.playerClan(playerId);
    return this.withLocks([`player:${playerId}`, owned ? `clan:${owned.clanId}` : ''], () => {
      const clan = this.playerClan(playerId);
      const session = this.session(playerId);
      if (!clan) {
        session.message = CLAN_NOT_IN_CLAN_ERROR;
        session.screen = 'ranking';
        return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      }
      if (!canClanAnnounce(this.roleOf(clan, playerId))) {
        session.message = CLAN_OWNER_ONLY_ERROR;
        session.screen = 'card';
        session.selectedClanId = clan.clanId;
        return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      }
      session.screen = 'announce';
      session.selectedClanId = clan.clanId;
      const parsed = normalizeOutgoingChatText(rawText ?? '');
      session.announceText = parsed.slice(0, MAX_CHAT_LENGTH);
      if (!parsed) {
        session.message = CLAN_ANNOUNCE_EMPTY_ERROR;
        return { ok: false, error: CLAN_ANNOUNCE_EMPTY_ERROR, clan };
      }
      if (parsed.length > MAX_CHAT_LENGTH) {
        session.message = CHAT_TOO_LONG_ERROR;
        return { ok: false, error: CHAT_TOO_LONG_ERROR, clan };
      }
      const remaining = (clan.announcementCooldownUntil ?? 0) - this.now();
      if (remaining > 0) {
        session.message = clanAnnounceCooldownLabel(remaining);
        return { ok: false, error: session.message, clan };
      }
      clan.announcementCooldownUntil = this.now() + CLAN_ANNOUNCEMENT_COOLDOWN_MS;
      this.persist();
      session.announceText = '';
      session.message = undefined;
      const line = clanAnnouncementChat(parsed);
      for (const memberId of clan.memberIds) {
        if (!this.runtime.isOnline(memberId)) continue;
        this.runtime.sendMessage(memberId, line, { channel: 'clan', style: 'announcement' });
      }
      return { ok: true, clan };
    });
  }

  isClanMember(clanId: string, playerId: string): boolean {
    return this.getClan(clanId)?.memberIds.includes(playerId) === true;
  }

  onClanClaimRemoved(claimId: string): void {
    for (const clan of this.clans.values()) {
      if (clan.base?.claimId !== claimId) continue;
      delete clan.base;
      this.persist();
      return;
    }
  }

  setClanBase(playerId: string): ClanResult {
    const owned = this.playerClan(playerId);
    return this.withLocks([`player:${playerId}`, owned ? `clan:${owned.clanId}` : ''], () => {
      const clan = this.playerClan(playerId);
      const session = this.session(playerId);
      session.screen = clan ? 'card' : 'ranking';
      if (clan) session.selectedClanId = clan.clanId;
      if (!clan) {
        session.message = CLAN_NOT_IN_CLAN_ERROR;
        return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      }
      if (!canClanSetBase(this.roleOf(clan, playerId))) {
        session.message = CLAN_OWNER_ONLY_ERROR;
        return { ok: false, error: CLAN_OWNER_ONLY_ERROR, clan };
      }
      const remaining = Math.max(0, (clan.baseCooldownUntil ?? 0) - this.now());
      if (remaining > 0) {
        session.message = clanBaseCooldownLabel(remaining);
        return { ok: false, error: session.message, clan };
      }
      const pos = this.runtime.playerPosition?.(playerId);
      if (!pos || !this.runtime.getBlock || !this.runtime.setBlock || !this.runtime.loadClaims || !this.runtime.saveClaims) {
        session.message = CLAN_BASE_POSITION_ERROR;
        return { ok: false, error: CLAN_BASE_POSITION_ERROR, clan };
      }
      const worldId = this.runtime.worldId?.() ?? '';
      if (!worldId) {
        session.message = CLAN_BASE_POSITION_ERROR;
        return { ok: false, error: CLAN_BASE_POSITION_ERROR, clan };
      }
      const resolved = resolveClanBaseAnchor(pos, this.runtime.getBlock);
      if (!resolved.ok) {
        session.message = resolved.error;
        return { ok: false, error: resolved.error, clan };
      }
      const { anchor } = resolved;
      if (clan.base
        && clan.base.worldId === worldId
        && clan.base.x === anchor.x
        && clan.base.y === anchor.y
        && clan.base.z === anchor.z) {
        session.message = CLAN_BASE_ALREADY_HERE_ERROR;
        return { ok: false, error: CLAN_BASE_ALREADY_HERE_ERROR, clan };
      }
      const volume = createClanBaseClaim(clan.clanId, clan.name, worldId, anchor).volume;
      const store = this.runtime.loadClaims();
      const overlapping = overlappingClaims(store.claims, worldId, volume, clan.base?.claimId);
      if (overlapping.length > 0) {
        session.message = CLAN_BASE_OVERLAP_ERROR;
        return { ok: false, error: CLAN_BASE_OVERLAP_ERROR, clan };
      }
      if (this.runtime.getBlock(anchor.x, anchor.y, anchor.z) === BlockId.Bedrock) {
        session.message = CLAN_BASE_ANCHOR_ERROR;
        return { ok: false, error: CLAN_BASE_ANCHOR_ERROR, clan };
      }
      const previous = clan.base;
      if (!this.runtime.setBlock(anchor.x, anchor.y, anchor.z, BlockId.DiamondBlock)) {
        session.message = CLAN_BASE_ANCHOR_ERROR;
        return { ok: false, error: CLAN_BASE_ANCHOR_ERROR, clan };
      }
      const created = createClanBaseClaim(clan.clanId, clan.name, worldId, anchor);
      store.claims = store.claims.filter((claim) => claim.id !== previous?.claimId && claim.clanId !== clan.clanId);
      store.claims.push(created);
      this.runtime.saveClaims(store);
      if (previous && (previous.x !== anchor.x || previous.y !== anchor.y || previous.z !== anchor.z || previous.worldId !== worldId)) {
        this.runtime.setBlock(previous.x, previous.y, previous.z, BlockId.Air);
      }
      clan.base = {
        worldId,
        x: anchor.x,
        y: anchor.y,
        z: anchor.z,
        claimId: created.id,
      };
      clan.baseCooldownUntil = this.now() + CLAN_BASE_COOLDOWN_MS;
      this.persist();
      this.runtime.showClaim?.(playerId, created);
      session.message = previous ? CLAN_BASE_CHANGED_MESSAGE : CLAN_BASE_SET_MESSAGE;
      return { ok: true, clan };
    });
  }

  teleportToClanBase(playerId: string): ClanResult {
    const owned = this.playerClan(playerId);
    return this.withLocks([`player:${playerId}`, owned ? `clan:${owned.clanId}` : ''], () => {
      const clan = this.playerClan(playerId);
      const session = this.session(playerId);
      session.screen = clan ? 'card' : 'ranking';
      if (clan) session.selectedClanId = clan.clanId;
      if (!clan) {
        session.message = CLAN_NOT_IN_CLAN_ERROR;
        return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      }
      if (!clan.base) {
        session.message = CLAN_BASE_MISSING_ERROR;
        return { ok: false, error: CLAN_BASE_MISSING_ERROR, clan };
      }
      const worldId = this.runtime.worldId?.();
      if (worldId && clan.base.worldId !== worldId) {
        session.message = CLAN_BASE_WORLD_ERROR;
        return { ok: false, error: CLAN_BASE_WORLD_ERROR, clan };
      }
      if (!this.runtime.teleportNow) {
        session.message = CLAN_BASE_MISSING_ERROR;
        return { ok: false, error: CLAN_BASE_MISSING_ERROR, clan };
      }
      const dest = clanBaseTeleportDest(clan.base);
      const result = this.runtime.teleportNow(playerId, dest);
      if (!result.ok) {
        session.message = result.error ?? CLAN_BASE_POSITION_ERROR;
        return { ok: false, error: session.message, clan };
      }
      session.message = CLAN_BASE_TELEPORT_MESSAGE;
      return { ok: true, clan };
    });
  }

  private removeClanBaseClaim(clan: ClanRecord): void {
    const store = this.runtime.loadClaims?.();
    if (store) {
      const next = store.claims.filter((claim) => claim.id !== clan.base?.claimId && claim.clanId !== clan.clanId);
      if (next.length !== store.claims.length) {
        store.claims = next;
        this.runtime.saveClaims?.(store);
      }
    }
    if (clan.base && this.runtime.setBlock) {
      this.runtime.setBlock(clan.base.x, clan.base.y, clan.base.z, BlockId.Air);
    }
    delete clan.base;
  }

  leaveClan(playerId: string): ClanResult {
    return this.withLocks([`player:${playerId}`], () => {
      const clan = this.playerClan(playerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (clan.ownerId === playerId) return { ok: false, error: CLAN_OWNER_LEAVE_ERROR };
      this.detachFromClans(playerId);
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
      if (this.roleOf(clan, targetId) !== 'veteran') return { ok: false, error: CLAN_TRANSFER_VETERAN_ONLY_ERROR };
      clan.roles[ownerId] = 'veteran';
      clan.roles[targetId] = 'leader';
      clan.ownerId = targetId;
      this.syncRoles(clan);
      this.persist();
      const session = this.session(ownerId);
      session.screen = 'card';
      session.selectedClanId = clan.clanId;
      session.selectedMemberId = undefined;
      session.transferFromCard = undefined;
      session.message = `${this.runtime.displayName(targetId)} теперь глава клана ${clan.name}.`;
      return { ok: true, clan };
    });
  }

  promoteVeteran(ownerId: string, targetId: string): ClanResult {
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (!canClanManageVeterans(this.roleOf(clan, ownerId))) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
      if (this.roleOf(clan, targetId) !== 'member') return { ok: false, error: CLAN_PROMOTE_MEMBER_ONLY_ERROR };
      clan.roles[targetId] = 'veteran';
      this.syncRoles(clan);
      this.persist();
      this.runtime.notifyUnread?.(targetId, 'clans');
      const session = this.session(ownerId);
      session.selectedMemberId = targetId;
      session.screen = 'member-card';
      session.message = `${this.runtime.displayName(targetId)} назначен ветераном.`;
      return { ok: true, clan };
    });
  }

  demoteVeteran(ownerId: string, targetId: string): ClanResult {
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (!canClanManageVeterans(this.roleOf(clan, ownerId))) return { ok: false, error: CLAN_OWNER_ONLY_ERROR };
      if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
      if (this.roleOf(clan, targetId) !== 'veteran') return { ok: false, error: CLAN_DEMOTE_VETERAN_ONLY_ERROR };
      clan.roles[targetId] = 'member';
      this.syncRoles(clan);
      this.persist();
      const session = this.session(ownerId);
      session.selectedMemberId = targetId;
      session.screen = 'member-card';
      session.message = `${this.runtime.displayName(targetId)} снова участник.`;
      return { ok: true, clan };
    });
  }

  kickMember(ownerId: string, targetId: string): ClanResult {
    return this.withLocks([`player:${ownerId}`, `player:${targetId}`], () => {
      const clan = this.playerClan(ownerId);
      if (!clan) return { ok: false, error: CLAN_NOT_IN_CLAN_ERROR };
      if (targetId === ownerId) return { ok: false, error: CLAN_KICK_SELF_ERROR };
      if (!clan.memberIds.includes(targetId)) return { ok: false, error: CLAN_NOT_MEMBER_ERROR };
      if (!canClanKick(this.roleOf(clan, ownerId), this.roleOf(clan, targetId))) {
        return { ok: false, error: CLAN_KICK_DENIED_ERROR };
      }
      this.detachFromClans(targetId);
      this.persist();
      this.runtime.notifyUnread?.(targetId, 'clans');
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
      clan.roles[request.playerId] = 'member';
      this.syncRoles(clan);
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
    const purgedInvites = this.purgeExpired();
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
    if (action === 'set_invite_name') {
      session.inviteName = typeof message.name === 'string' ? message.name.slice(0, 24) : '';
      session.inviteMessage = undefined;
      return;
    }
    if (action === 'invite_by_name') {
      const clan = this.playerClan(playerId);
      if (!clan || !canClanInvite(this.roleOf(clan, playerId))) {
        session.inviteMessage = CLAN_OWNER_ONLY_ERROR;
        return;
      }
      if (session.screen !== 'requests') session.screen = 'requests';
      this.invitePlayerByName(playerId, message.name ?? session.inviteName);
      return;
    }
    if (action === 'set_member_sort' && isClanMemberSort(message.sort)) {
      session.memberSort = message.sort;
      if (session.screen === 'closed') session.screen = 'card';
      return;
    }
    if (action === 'set_ranking_sort' && isClanMemberSort(message.sort)) {
      session.rankingSort = message.sort;
      session.page = 1;
      if (session.screen === 'closed') session.screen = 'ranking';
      return;
    }
    if (action === 'select_icon' && isClanIconId(message.icon)) {
      if (session.screen !== 'create' && session.screen !== 'create-confirm') return;
      session.selectedIcon = message.icon;
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
      const invitationId = message.invitationId ?? session.selectedInvitationId;
      if (!invitationId) {
        session.screen = 'accept';
        session.message = CLAN_INVITE_MISSING_ERROR;
        return;
      }
      const result = this.acceptInvitation(playerId, invitationId);
      if (!result.ok) {
        session.screen = session.acceptFromCard && session.selectedClanId ? 'card' : 'accept';
        session.message = result.error;
      }
      session.acceptFromCard = false;
      return;
    }
    if (action === 'cancel_accept') {
      session.screen = session.acceptFromCard && session.selectedClanId ? 'card' : 'accept';
      session.selectedInvitationId = undefined;
      session.acceptFromCard = false;
      return;
    }
    if (action === 'reject_invitation') {
      const invitationId = message.invitationId ?? session.selectedInvitationId;
      if (!invitationId) {
        session.screen = 'accept';
        session.message = CLAN_INVITE_MISSING_ERROR;
        return;
      }
      const result = this.rejectInvitation(playerId, invitationId);
      if (!result.ok) session.message = result.error;
      return;
    }
    if (action === 'open_announce') {
      const result = this.openAnnounce(playerId);
      if (!result.ok) {
        session.screen = this.playerClan(playerId) ? 'card' : 'ranking';
        session.message = result.error;
      }
      return;
    }
    if (action === 'set_announce_text') {
      const clan = this.playerClan(playerId);
      if (!clan || !canClanAnnounce(this.roleOf(clan, playerId))) {
        session.message = CLAN_OWNER_ONLY_ERROR;
        session.screen = clan ? 'card' : 'ranking';
        return;
      }
      session.announceText = typeof message.text === 'string' ? message.text.slice(0, MAX_CHAT_LENGTH) : '';
      session.screen = 'announce';
      return;
    }
    if (action === 'send_announcement') {
      const result = this.sendAnnouncement(playerId, message.text ?? session.announceText);
      if (!result.ok) session.message = result.error;
      return;
    }
    if (action === 'set_base') {
      const clan = this.playerClan(playerId);
      if (!clan) {
        session.screen = 'ranking';
        session.message = CLAN_NOT_IN_CLAN_ERROR;
        return;
      }
      if (!canClanSetBase(this.roleOf(clan, playerId))) {
        session.screen = 'card';
        session.selectedClanId = clan.clanId;
        session.message = CLAN_OWNER_ONLY_ERROR;
        return;
      }
      session.screen = 'set-base-confirm';
      session.selectedClanId = clan.clanId;
      session.message = undefined;
      return;
    }
    if (action === 'confirm_set_base') {
      this.setClanBase(playerId);
      return;
    }
    if (action === 'cancel_set_base') {
      const clan = this.playerClan(playerId);
      session.screen = clan ? 'card' : 'ranking';
      if (clan) session.selectedClanId = clan.clanId;
      return;
    }
    if (action === 'teleport_to_base') {
      this.teleportToClanBase(playerId);
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
      if (clan && clan.memberIds.includes(message.playerId)) {
        session.selectedMemberId = message.playerId;
        if (session.screen === 'makeleader') {
          if (clan.ownerId === playerId && this.roleOf(clan, message.playerId) === 'veteran') {
            session.screen = 'makeleader-confirm';
          } else {
            session.message = CLAN_TRANSFER_VETERAN_ONLY_ERROR;
          }
        } else {
          session.screen = 'member-card';
        }
      }
      return;
    }
    if (action === 'open_member' && message.playerId) {
      const clan = this.getClan(session.selectedClanId) ?? this.playerClan(playerId);
      if (clan && clan.memberIds.includes(message.playerId)) {
        session.selectedMemberId = message.playerId;
        session.screen = 'member-card';
      }
      return;
    }
    if (action === 'promote_veteran') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) return;
      const result = this.promoteVeteran(playerId, target);
      if (!result.ok) session.message = result.error;
      return;
    }
    if (action === 'demote_veteran') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) return;
      const result = this.demoteVeteran(playerId, target);
      if (!result.ok) session.message = result.error;
      return;
    }
    if (action === 'transfer_leader') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) return;
      const clan = this.playerClan(playerId);
      if (!clan || clan.ownerId !== playerId || this.roleOf(clan, target) !== 'veteran') {
        session.message = CLAN_TRANSFER_VETERAN_ONLY_ERROR;
        session.screen = 'member-card';
        return;
      }
      session.selectedMemberId = target;
      session.transferFromCard = true;
      session.screen = 'transfer-confirm';
      return;
    }
    if (action === 'confirm_transfer_leader' || action === 'confirm_makeleader') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) {
        session.screen = session.transferFromCard ? 'member-card' : 'makeleader';
        session.message = 'Выберите участника.';
        return;
      }
      const result = this.makeLeader(playerId, target);
      if (!result.ok) {
        session.screen = session.transferFromCard ? 'member-card' : 'makeleader';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_transfer_leader') {
      session.screen = session.transferFromCard ? 'member-card' : 'makeleader';
      session.transferFromCard = undefined;
      return;
    }
    if (action === 'friends_request') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) return;
      const result = this.runtime.requestFriend?.(playerId, target);
      session.screen = 'member-card';
      session.message = result?.ok ? undefined : (result?.error ?? 'Не удалось отправить заявку.');
      return;
    }
    if (action === 'friends_cancel') {
      const target = session.selectedMemberId ?? message.playerId;
      if (!target) return;
      const result = this.runtime.cancelFriendRequest?.(playerId, target);
      session.screen = 'member-card';
      session.message = result?.ok ? undefined : (result?.error ?? 'Заявка не найдена.');
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
      const clan = this.playerClan(playerId);
      if (!clan || !canClanKick(this.roleOf(clan, playerId), this.roleOf(clan, target))) {
        session.screen = 'member-card';
        session.message = CLAN_KICK_DENIED_ERROR;
        return;
      }
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
        session.screen = 'member-card';
        session.message = result.error;
      }
      return;
    }
    if (action === 'cancel_kick') {
      session.screen = session.selectedMemberId ? 'member-card' : 'card';
      return;
    }
    if (action === 'join' && (message.clanId || session.selectedClanId)) {
      const clanId = message.clanId ?? session.selectedClanId!;
      session.selectedClanId = clanId;
      const invitation = [...this.invitations.values()].find(
        (row) => row.toPlayerId === playerId && row.clanId === clanId,
      );
      if (invitation) {
        session.selectedInvitationId = invitation.invitationId;
        session.acceptFromCard = true;
        session.screen = 'accept-confirm';
        return;
      }
      if (purgedInvites.some((row) => row.toPlayerId === playerId && row.clanId === clanId)) {
        session.screen = 'card';
        session.message = CLAN_INVITE_MISSING_ERROR;
        return;
      }
      const existing = this.playerRequest(playerId);
      const clan = this.clans.get(clanId);
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
      if (!clan || !canClanInvite(this.roleOf(clan, playerId))) {
        session.message = CLAN_OWNER_ONLY_ERROR;
        return;
      }
      session.screen = 'requests';
      session.selectedClanId = clan.clanId;
      session.selectedRequestId = undefined;
      session.inviteName = session.inviteName ?? '';
      session.inviteMessage = undefined;
      session.search = '';
      session.page = 1;
      return;
    }
    if (action === 'select_request' && message.requestId) {
      const clan = this.playerClan(playerId);
      if (!clan || clan.ownerId !== playerId) {
        session.message = CLAN_OWNER_ONLY_ERROR;
        return;
      }
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
      const viewerClan = this.playerClan(playerId);
      return {
        type: 'clan',
        screen: 'closed',
        title: '',
        search: '',
        page: 1,
        totalPages: 1,
        totalCount: 0,
        clans: [],
        viewer: {
          ...(viewerClan ? { clanId: viewerClan.clanId } : {}),
          isOwner: viewerClan?.ownerId === playerId,
        },
      };
    }
    const viewerClan = this.playerClan(playerId);
    const pending = this.playerRequest(playerId);
    const pendingClan = pending ? this.clans.get(pending.clanId) : undefined;
    const base = {
      type: 'clan' as const,
      search: session.search,
      page: session.page,
      ...(session.openedFromMenu ? { source: 'menu' as const } : {}),
      viewer: {
        ...(viewerClan ? { clanId: viewerClan.clanId } : {}),
        isOwner: viewerClan?.ownerId === playerId,
        ...(viewerClan ? {
          role: this.roleOf(viewerClan, playerId),
          canInvite: canClanInvite(this.roleOf(viewerClan, playerId)),
        } : {}),
        ...(pendingClan ? { pendingRequestClanId: pendingClan.clanId, pendingRequestClanName: pendingClan.name } : {}),
      },
      inviteName: session.inviteName,
      memberSort: session.memberSort,
      rankingSort: session.rankingSort,
      ...(session.inviteMessage ? { inviteMessage: session.inviteMessage } : {}),
      ...(session.message ? { message: session.message } : {}),
    };

    if (session.screen === 'ranking') {
      const ranked = this.ranked(session.search, session.rankingSort);
      const paged = this.paginate(ranked, session);
      return {
        ...base,
        screen: 'ranking',
        title: 'Кланы',
        page: session.page,
        totalPages: paged.totalPages,
        totalCount: ranked.length,
        rankingSort: session.rankingSort,
        clans: paged.items.map((row) => this.toRow(row.clan, row.total, row.rank, session.rankingSort, row.kills)),
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

    if (session.screen === 'makeleader' || session.screen === 'makeleader-confirm' || session.screen === 'transfer-confirm') {
      const clan = viewerClan;
      const members = clan ? this.memberRows(clan).filter((row) => row.role === 'veteran') : [];
      const selected = members.find((row) => row.playerId === session.selectedMemberId)
        ?? (clan ? this.memberRows(clan).find((row) => row.playerId === session.selectedMemberId) : undefined);
      const confirm = session.screen === 'makeleader-confirm' || session.screen === 'transfer-confirm';
      return {
        ...base,
        screen: session.screen,
        title: 'Передать главу',
        totalPages: 1,
        totalCount: members.length,
        clans: [],
        members,
        playerCard: clan && session.selectedMemberId ? this.playerCardPayload(playerId, clan, session.selectedMemberId) : undefined,
        selected: confirm && selected && clan
          ? {
            playerId: selected.playerId,
            playerName: selected.name,
            clanName: clan.name,
            prompt: `Вы уверены, что хотите передать главу игроку ${selected.name}?\n\nВы станете ветераном клана ${clan.name}.\nЭто действие нельзя отменить.`,
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
        inviteName: session.inviteName,
        ...(session.inviteMessage ? { inviteMessage: session.inviteMessage } : {}),
        card: clan ? this.cardPayload(playerId, clan, session.selectedMemberId) : undefined,
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

    if (session.screen === 'set-base-confirm') {
      const clan = viewerClan;
      if (!clan || !canClanSetBase(this.roleOf(clan, playerId))) {
        session.screen = clan ? 'card' : 'ranking';
        return this.buildMessage(playerId);
      }
      return {
        ...base,
        screen: 'set-base-confirm',
        title: clan.base ? CLAN_BASE_CHANGE_LABEL : CLAN_BASE_SET_LABEL,
        totalPages: 1,
        totalCount: 0,
        clans: [this.toRow(clan, this.clanTotal(clan), this.rankOf(clan.clanId, session.rankingSort))],
        card: this.cardPayload(playerId, clan, session.selectedMemberId),
        selected: {
          clanId: clan.clanId,
          clanName: clan.name,
          prompt: clanBaseConfirmPrompt(!!clan.base),
        },
      };
    }

    if (session.screen === 'announce') {
      const clan = viewerClan;
      if (!clan || !canClanAnnounce(this.roleOf(clan, playerId))) {
        session.screen = clan ? 'card' : 'ranking';
        return this.buildMessage(playerId);
      }
      const remaining = Math.max(0, (clan.announcementCooldownUntil ?? 0) - this.now());
      return {
        ...base,
        screen: 'announce',
        title: 'Объявление соклановцам',
        totalPages: 1,
        totalCount: 0,
        clans: [this.toRow(clan, this.clanTotal(clan), this.rankOf(clan.clanId, session.rankingSort))],
        card: this.cardPayload(playerId, clan, session.selectedMemberId),
        announceText: session.announceText,
        canAnnounce: true,
        ...this.announceCooldownFields(clan),
        ...(remaining > 0 ? { announceCooldownLabel: clanAnnounceCooldownLabel(remaining) } : {}),
      };
    }

    if (session.screen === 'member-card') {
      const memberClan = this.getClan(session.selectedClanId) ?? viewerClan;
      const card = memberClan && session.selectedMemberId
        ? this.playerCardPayload(playerId, memberClan, session.selectedMemberId)
        : undefined;
      if (!memberClan || !card) {
        session.screen = 'card';
        return this.buildMessage(playerId);
      }
      return {
        ...base,
        screen: 'member-card',
        title: card.name,
        totalPages: 1,
        totalCount: 1,
        clans: [this.toRow(memberClan, this.clanTotal(memberClan), this.rankOf(memberClan.clanId, session.rankingSort))],
        members: this.memberRows(memberClan, session.memberSort),
        card: this.cardPayload(playerId, memberClan, session.selectedMemberId),
        playerCard: card,
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
      clans: [this.toRow(clan, this.clanTotal(clan), this.rankOf(clan.clanId, session.rankingSort))],
      members: this.memberRows(clan, session.memberSort),
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
          if (session.menuEntry === 'mine' && session.openedFromMenu) {
            this.closeSession(playerId);
            return;
          }
          this.openRanking(playerId);
          return;
        }
        this.closeSession(playerId);
        return;
      case 'ranking':
        if (session.openedFromMenu) {
          this.closeSession(playerId);
          return;
        }
        return;
      case 'create-confirm':
        session.screen = 'create';
        return;
      case 'invite-confirm':
        session.screen = 'add';
        session.selectedPlayerId = undefined;
        return;
      case 'accept-confirm':
        if (session.acceptFromCard && session.selectedClanId) {
          session.screen = 'card';
          session.acceptFromCard = false;
          session.selectedInvitationId = undefined;
          return;
        }
        session.screen = 'accept';
        session.selectedInvitationId = undefined;
        return;
      case 'makeleader-confirm':
        session.screen = 'makeleader';
        session.selectedMemberId = undefined;
        return;
      case 'transfer-confirm':
        session.screen = session.transferFromCard ? 'member-card' : 'makeleader';
        session.transferFromCard = undefined;
        return;
      case 'member-card':
        session.screen = 'card';
        return;
      case 'kick-confirm':
        session.screen = session.selectedMemberId ? 'member-card' : 'card';
        return;
      case 'join-confirm':
      case 'replace-request-confirm':
        session.screen = 'card';
        return;
      case 'requests':
        session.screen = 'card';
        return;
      case 'announce':
        session.screen = 'card';
        return;
      case 'set-base-confirm':
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

  private memberRows(clan: ClanRecord, sort: ClanMemberSort = 'money'): NetworkClanMember[] {
    const rows = clan.memberIds.map((memberId) => {
      const balance = this.economy.getBalance(memberId);
      const kills = this.economy.getKills(memberId);
      const role = this.roleOf(clan, memberId);
      return {
        playerId: memberId,
        name: this.runtime.displayName(memberId),
        balance,
        balanceLabel: coinLabel(balance),
        isOwner: memberId === clan.ownerId,
        role,
        roleLabel: clanRoleLabel(role),
        online: this.runtime.isOnline(memberId),
        kills,
        killsLabel: formatKillsLabel(kills),
      };
    });
    const metric = sort === 'kills' ? 'kills' : 'money';
    rows.sort((a, b) => {
      if (a.role === 'leader' && b.role !== 'leader') return -1;
      if (b.role === 'leader' && a.role !== 'leader') return 1;
      const av = metric === 'kills' ? a.kills : a.balance;
      const bv = metric === 'kills' ? b.kills : b.balance;
      if (bv !== av) return bv - av;
      return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
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
        fromPlayerId: invitation.fromPlayerId,
        fromName: this.runtime.displayName(invitation.fromPlayerId),
        expiresAt: invitation.expiresAt,
        remainingLabel: formatRemainingDuration(invitation.expiresAt - this.now()),
      });
    }
    return rows;
  }

  private toRow(
    clan: ClanRecord,
    total: number,
    rank: number,
    sort: ClanMemberSort = 'money',
    kills = this.clanKills(clan),
  ): NetworkClanRow {
    return {
      clanId: clan.clanId,
      name: clan.name,
      icon: clan.icon,
      rank,
      totalBalance: total,
      totalLabel: coinLabel(total),
      totalKills: kills,
      killsLabel: formatKillsLabel(kills),
      memberCount: clan.memberIds.length,
      createdAt: clan.createdAt,
      sort,
    };
  }

  private rankOf(clanId: string, sort: ClanMemberSort = 'money'): number {
    return this.ranked('', sort).find((row) => row.clan.clanId === clanId)?.rank ?? 0;
  }

  private cardPayload(playerId: string, clan: ClanRecord, selectedMemberId: string | undefined): NonNullable<ServerClanMessage['card']> {
    const own = this.playerClan(playerId);
    const pending = this.playerRequest(playerId);
    const invitation = this.invitationFor(playerId, clan.clanId);
    const isOwner = clan.ownerId === playerId;
    const isMember = clan.memberIds.includes(playerId);
    const isFull = clan.memberIds.length >= CLAN_MAX_MEMBERS;
    let joinState: NonNullable<ServerClanMessage['card']>['joinState'] = 'none';
    let joinLabel: string | undefined;
    if (isMember) joinState = 'own';
    else if (own) {
      joinState = 'other-clan';
      joinLabel = 'Вы уже состоите в другом клане.';
    } else if (invitation) {
      joinState = 'invited';
      joinLabel = 'Вступить в клан';
    } else if (isFull) {
      joinState = 'full';
      joinLabel = CLAN_FULL_ERROR;
    } else if (pending?.clanId === clan.clanId) {
      joinState = 'sent';
      joinLabel = 'Заявка отправлена';
    }
    const canKick = !!selectedMemberId
      && selectedMemberId !== playerId
      && clan.memberIds.includes(selectedMemberId)
      && canClanKick(this.roleOf(clan, playerId), this.roleOf(clan, selectedMemberId));
    const viewerRole = clan.memberIds.includes(playerId) ? this.roleOf(clan, playerId) : undefined;
    return {
      clanId: clan.clanId,
      name: clan.name,
      icon: clan.icon,
      totalBalance: this.clanTotal(clan),
      totalLabel: coinLabel(this.clanTotal(clan)),
      totalKills: this.clanKills(clan),
      killsLabel: formatKillsLabel(this.clanKills(clan)),
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
      canInvite: canClanInvite(viewerRole),
      canAnnounce: canClanAnnounce(viewerRole),
      ...(this.announceCooldownFields(clan)),
      ...(this.baseCardFields(clan, viewerRole, isMember)),
      ...(viewerRole ? { viewerRole } : {}),
      memberSort: this.session(playerId).memberSort,
      rankingSort: this.session(playerId).rankingSort,
    };
  }

  private announceCooldownFields(clan: ClanRecord): {
    announceCooldownUntil?: number;
    announceCooldownLabel?: string;
  } {
    const remaining = Math.max(0, (clan.announcementCooldownUntil ?? 0) - this.now());
    if (remaining <= 0) return {};
    return {
      announceCooldownUntil: clan.announcementCooldownUntil,
      announceCooldownLabel: clanAnnounceCooldownLabel(remaining),
    };
  }

  private baseCardFields(
    clan: ClanRecord,
    viewerRole: ClanRole | undefined,
    isMember: boolean,
  ): Pick<
    NonNullable<ServerClanMessage['card']>,
    'hasBase' | 'baseLabel' | 'canSetBase' | 'setBaseLabel' | 'setBaseDisabled' | 'baseCooldownUntil' | 'baseCooldownLabel' | 'canTeleportToBase'
  > {
    const hasBase = !!clan.base;
    const remaining = Math.max(0, (clan.baseCooldownUntil ?? 0) - this.now());
    const canSetBase = isMember && canClanSetBase(viewerRole);
    return {
      hasBase,
      baseLabel: hasBase ? CLAN_BASE_PRESENT_LABEL : CLAN_BASE_ABSENT_LABEL,
      canSetBase,
      setBaseLabel: hasBase ? CLAN_BASE_CHANGE_LABEL : CLAN_BASE_SET_LABEL,
      setBaseDisabled: canSetBase && remaining > 0,
      canTeleportToBase: isMember && hasBase,
      ...(remaining > 0 ? {
        baseCooldownUntil: clan.baseCooldownUntil,
        baseCooldownLabel: clanBaseCooldownLabel(remaining),
      } : {}),
    };
  }

  private playerCardPayload(viewerId: string, clan: ClanRecord, memberId: string): NonNullable<ServerClanMessage['playerCard']> | undefined {
    if (!clan.memberIds.includes(memberId)) return undefined;
    const role = this.roleOf(clan, memberId);
    const viewerRole = clan.memberIds.includes(viewerId) ? this.roleOf(clan, viewerId) : undefined;
    const online = this.runtime.isOnline(memberId);
    const name = this.runtime.displayName(memberId);
    const balance = this.economy.getBalance(memberId);
    const kills = this.economy.getKills(memberId);
    const isSelf = viewerId === memberId;
    const friendState = isSelf
      ? 'self' as const
      : (this.runtime.friendRelation?.(viewerId, memberId) ?? 'none');
    return {
      playerId: memberId,
      name,
      online,
      role,
      roleLabel: clanRoleLabel(role),
      balance,
      balanceLabel: coinLabel(balance),
      kills,
      killsLabel: formatKillsLabel(kills),
      isSelf,
      friendState,
      canKick: !isSelf && canClanKick(viewerRole, role),
      canPromote: !isSelf && canClanManageVeterans(viewerRole) && role === 'member',
      canDemote: !isSelf && canClanManageVeterans(viewerRole) && role === 'veteran',
      canTransfer: !isSelf && canClanTransferLeader(viewerRole, role),
      statusLabel: online ? 'В сети' : `Игрок ${name} не в сети`,
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
