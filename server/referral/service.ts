import {
  REFERRAL_ACTIVE_SECONDS,
  REFERRAL_KIT_NAME,
  REFERRAL_PAGE_SIZE,
  formatActiveProgress,
  friendsUntilMilestone,
  parseReferralCode,
  referralPublicUrl,
  referralRewardTitle,
  type ReferralMenuState,
  type ReferralMilestone,
} from '../../shared/referral';
import type { EffectiveRank } from '../../shared/donationRanks';
import { InviteeActivityClock, REFERRAL_OUTAGE_PENDING_MS } from './activity';
import type { ActivitySample } from './activity';
import { resolveEntitlements, type RewardEntitlement } from './benefits';
import type { KitStack } from '../services/kit';
import type { ReferralRepository } from './types';
import type { RelationRow, RewardRow } from './types';

const ACCEPT_LIMIT = 6;
const CLAIM_LIMIT = 4;
const WINDOW_MS = 60_000;
const REFRESH_MS = 2_000;

export interface ReferralKitDelivery {
  deliver(referralId: string, items: readonly KitStack[]): Promise<'delivered' | 'full' | 'missing' | 'already' | 'failed'>;
  hasReceipt(referralId: string): boolean;
}

export interface ReferralDeps {
  readonly repository: ReferralRepository;
  readonly activityEnabled: boolean;
  readonly devTools: boolean;
  readonly publicGameUrl: string | null;
  now(): number;
  paidRank(playerId: string, now: number): EffectiveRank;
  /** True when the paid-rank file could not be read. Referral perks stay off. */
  paidRankUnreadable(playerId: string): boolean;
  displayName(playerId: string): string;
  yandexLink(playerId: string): Promise<'linked' | 'guest' | 'unknown'>;
  kitItems(): readonly KitStack[] | null;
  kitDelivery(playerId: string): ReferralKitDelivery | null;
  notify(playerId: string, text: string): void;
  onBenefitsChanged(playerId: string): void;
  auditDev?(actorId: string, action: string, targetId: string, detail: string): Promise<void>;
}

interface Track {
  connectionId: string;
  referralId: string;
  clock: InviteeActivityClock;
  flushing: boolean;
  uncertain: boolean;
  inFlight: { delta: number; expected: number } | null;
}

interface RankCache {
  rank: EffectiveRank;
  expiresAt?: number;
  paid: EffectiveRank;
  at: number;
}

const UNAVAILABLE = 'Реферальная программа временно недоступна. Сохранённый прогресс не потерян.';
const ANARCHY_ONLY = 'Активная игра засчитывается на Анархии. Этот режим часы не копит.';

/**
 * Server-owned referral program for one deployment, mode, and world.
 * Gameplay calls `sample` from the tick. SQL runs on a timer, on quit, or at the 3 hour mark.
 */
export class ReferralService {
  private readonly tracks = new Map<string, Track>();
  private readonly rewards = new Map<string, RewardRow[]>();
  private readonly ranks = new Map<string, RankCache>();
  private readonly lanes = new Map<string, Promise<void>>();
  private readonly hits = new Map<string, number[]>();
  private readonly announced = new Set<string>();
  private dbOk = true;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(private readonly deps: ReferralDeps | null, private readonly disabledNote: string | null) {}

  static unavailable(note: string): ReferralService {
    return new ReferralService(null, note);
  }

  static create(deps: ReferralDeps): ReferralService {
    return new ReferralService(deps, null);
  }

  get enabled(): boolean {
    return this.deps !== null;
  }

  tracking(): boolean {
    return this.tracks.size > 0;
  }

  rankView(playerId: string, now = this.deps?.now() ?? Date.now()): { rank: EffectiveRank; expiresAt?: number } {
    if (!this.deps || this.deps.paidRankUnreadable(playerId)) return { rank: 'default' };
    const paid = this.deps.paidRank(playerId, now);
    const cached = this.ranks.get(playerId);
    if (cached && cached.paid === paid && now - cached.at < 1000 && (cached.expiresAt === undefined || cached.expiresAt > now)) {
      return { rank: cached.rank, expiresAt: cached.expiresAt };
    }
    const rows = this.rewards.get(playerId);
    if (!rows) {
      this.ranks.set(playerId, { rank: 'default', paid, at: now });
      return { rank: 'default' };
    }
    const resolved = resolveEntitlements(rows, paid, now);
    if (resolved.changed) {
      this.rewards.set(playerId, resolved.rows);
      this.scheduleRewardSave(playerId, resolved.rows);
    }
    const view = {
      rank: resolved.activeRank,
      ...(resolved.activeExpiresAt !== null ? { expiresAt: resolved.activeExpiresAt } : {}),
      paid,
      at: now,
    };
    this.ranks.set(playerId, view);
    return { rank: view.rank, ...(view.expiresAt !== undefined ? { expiresAt: view.expiresAt } : {}) };
  }

  sample(sample: ActivitySample & { readonly playerId: string; readonly connectionId: string }): void {
    if (!this.deps?.activityEnabled) return;
    const track = this.tracks.get(sample.playerId);
    if (!track || track.connectionId !== sample.connectionId) return;
    const allow = this.dbOk || track.clock.pendingMs < REFERRAL_OUTAGE_PENDING_MS;
    track.clock.observe(sample, allow);
    if (track.clock.shouldFlush(!this.dbOk) || track.uncertain) this.arm(0);
    else this.arm(30_000);
  }

  noteAction(playerId: string): void {
    const track = this.tracks.get(playerId);
    if (!track || !this.deps?.activityEnabled) return;
    track.clock.mark(this.deps.now(), this.dbOk || track.clock.pendingMs < REFERRAL_OUTAGE_PENDING_MS);
    if (track.clock.shouldFlush(!this.dbOk)) this.arm(0);
  }

  onJoin(playerId: string, connectionId: string): Promise<void> {
    if (!this.deps) return Promise.resolve();
    return this.lane(playerId, async () => {
      const deps = this.deps!;
      try {
        const listed = await deps.repository.page(playerId, 1, 0);
        const rewards = await deps.repository.ensureMilestones(playerId, listed.qualified, deps.now());
        this.remember(playerId, rewards);
        const relation = await deps.repository.invitee(playerId);
        this.dbOk = true;
        if (!deps.activityEnabled || !relation || relation.status !== 'pending') {
          this.tracks.delete(playerId);
          return;
        }
        const existing = this.tracks.get(playerId);
        if (existing) {
          await this.flushTrack(playerId);
          const live = this.tracks.get(playerId);
          if (live) live.connectionId = connectionId;
          return;
        }
        this.tracks.set(playerId, {
          connectionId,
          referralId: relation.referralId,
          clock: new InviteeActivityClock(relation.activeSeconds, deps.now()),
          flushing: false,
          uncertain: false,
          inFlight: null,
        });
      } catch {
        this.dbOk = false;
      }
    });
  }

  onQuit(playerId: string, connectionId?: string): Promise<void> {
    if (!this.deps) return Promise.resolve();
    return this.lane(playerId, async () => {
      const track = this.tracks.get(playerId);
      if (!track) return;
      if (connectionId && track.connectionId !== connectionId) return;
      await this.flushTrack(playerId);
      this.tracks.delete(playerId);
    });
  }

  flushNow(playerId: string): Promise<void> {
    if (!this.deps) return Promise.resolve();
    return this.lane(playerId, () => this.flushTrack(playerId));
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const ids = [...this.tracks.keys()];
    for (const id of ids) await this.onQuit(id);
  }

  async view(playerId: string, page: number, draft?: string): Promise<ReferralMenuState> {
    if (!this.deps) return emptyMenu(this.disabledNote ?? UNAVAILABLE);
    if (!this.deps.activityEnabled) return emptyMenu(ANARCHY_ONLY);
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 50) : 1;
    try {
      const code = await this.deps.repository.ensureCode(playerId);
      const listed = await this.deps.repository.page(playerId, REFERRAL_PAGE_SIZE, (safePage - 1) * REFERRAL_PAGE_SIZE);
      const rewards = await this.deps.repository.rewards(playerId);
      this.remember(playerId, rewards);
      const relation = await this.deps.repository.invitee(playerId);
      const kit = await this.kitStatus(playerId, relation);
      const link = this.deps.publicGameUrl ? referralPublicUrl(this.deps.publicGameUrl, code) : undefined;
      const yandex = await this.deps.yandexLink(playerId);
      const draftCode = parseReferralCode(draft);
      let preview: string | undefined;
      if (draftCode) preview = await this.preview(playerId, draftCode);
      this.dbOk = true;
      const qualified = listed.qualified;
      return {
        available: true,
        activityNote: 'Активная игра засчитывается на Анархии.',
        code,
        ...(link ? { link } : {}),
        ...(draftCode ? { codeDraft: draftCode } : {}),
        ...(yandex === 'guest' ? { guestWarning: 'Без привязки к Яндекс ID прогресс этого персонажа можно потерять после очистки браузера.' } : {}),
        qualifiedCount: qualified,
        invitedCount: listed.total,
        invitees: listed.rows.map((row) => ({
          name: this.deps!.displayName(row.inviteeId),
          activeSeconds: row.activeSeconds,
          progressLabel: formatActiveProgress(row.activeSeconds, row.status),
          status: row.status,
        })),
        page: safePage,
        pageCount: Math.max(1, Math.ceil(listed.total / REFERRAL_PAGE_SIZE)),
        rewards: rewardLines(rewards, qualified, this.deps.now(), this.deps.paidRank(playerId, this.deps.now())),
        kit,
        ...(relation ? {
          invitedBy: this.deps.displayName(relation.referrerId),
          inviteeProgress: formatActiveProgress(relation.activeSeconds, relation.status),
        } : {}),
        rankNote: this.rankNote(playerId),
        ...(preview ? { unavailableReason: undefined } : {}),
      };
    } catch {
      this.dbOk = false;
      return emptyMenu(UNAVAILABLE);
    }
  }

  async previewMessage(playerId: string, raw: string | undefined): Promise<string | undefined> {
    const code = parseReferralCode(raw);
    if (!code || !this.deps?.activityEnabled) return undefined;
    try {
      return await this.preview(playerId, code);
    } catch {
      this.dbOk = false;
      return UNAVAILABLE;
    }
  }

  async accept(playerId: string, raw: string | undefined): Promise<string> {
    if (!this.deps) return this.disabledNote ?? UNAVAILABLE;
    if (!this.deps.activityEnabled) return ANARCHY_ONLY;
    if (!this.allow(`accept:${playerId}`, ACCEPT_LIMIT, WINDOW_MS)) return 'Слишком много попыток. Подождите немного.';
    const code = parseReferralCode(raw);
    if (!code) return 'Реферальный код не найден.';
    try {
      const result = await this.deps.repository.accept(playerId, code, this.deps.now());
      this.dbOk = true;
      if (result.status === 'not_found') return 'Реферальный код не найден.';
      if (result.status === 'self') return 'Нельзя использовать собственный код.';
      if (result.status === 'already') return 'Вы уже приняли приглашение.';
      const player = this.tracks.get(playerId);
      if (!player) {
        this.tracks.set(playerId, {
          connectionId: '',
          referralId: result.referralId,
          clock: new InviteeActivityClock(0, this.deps.now()),
          flushing: false,
          uncertain: false,
          inFlight: null,
        });
      }
      const name = this.deps.displayName(result.referrerId);
      return `Приглашение от ${name} принято. Активное время начнёт копиться с этого момента.`;
    } catch {
      this.dbOk = false;
      return UNAVAILABLE;
    }
  }

  /** The live connection starts the clock. Accept may happen before that id is known. */
  bindConnection(playerId: string, connectionId: string): void {
    const track = this.tracks.get(playerId);
    if (!track) return;
    if (track.connectionId === '') track.connectionId = connectionId;
  }

  async claim(playerId: string): Promise<string> {
    if (!this.deps) return this.disabledNote ?? UNAVAILABLE;
    if (!this.deps.activityEnabled) return ANARCHY_ONLY;
    if (!this.allow(`claim:${playerId}`, CLAIM_LIMIT, WINDOW_MS)) return 'Слишком много попыток. Подождите немного.';
    try {
      const relation = await this.deps.repository.invitee(playerId);
      if (!relation) return 'Сначала примите приглашение.';
      const delivery = this.deps.kitDelivery(playerId);
      if (delivery?.hasReceipt(relation.referralId)) {
        await this.deps.repository.markKitClaimed(relation.referralId, this.deps.now());
        return 'Стартовый набор уже получен.';
      }
      const items = this.deps.kitItems();
      if (!items || items.length === 0) return 'Набор referral_starter ещё не настроен. Право на него сохранено.';
      if (!delivery) return 'Стартовый набор можно забрать, пока вы в игре.';
      const result = await delivery.deliver(relation.referralId, items);
      this.dbOk = true;
      if (result === 'full') return 'Освободите место в инвентаре. Набор сохранён и не потерян.';
      if (result === 'failed' || result === 'missing') return 'Не удалось сохранить набор. Повторите попытку. Предметы не засчитаны как полученные.';
      await this.deps.repository.markKitClaimed(relation.referralId, this.deps.now());
      if (result === 'already') return 'Стартовый набор уже получен.';
      return 'Стартовый набор получен.';
    } catch {
      this.dbOk = false;
      return UNAVAILABLE;
    }
  }

  async reconcilePaid(playerId: string): Promise<void> {
    if (!this.deps) return;
    this.ranks.delete(playerId);
    const rows = this.rewards.get(playerId);
    if (!rows) return;
    const resolved = resolveEntitlements(rows, this.deps.paidRank(playerId, this.deps.now()), this.deps.now());
    this.rewards.set(playerId, resolved.rows);
    if (resolved.changed) await this.persistRewards(playerId, resolved.rows);
    this.deps.onBenefitsChanged(playerId);
  }

  async devStatus(actorId: string, targetId: string): Promise<string> {
    if (!this.deps) return this.disabledNote ?? UNAVAILABLE;
    try {
      const code = await this.deps.repository.ensureCode(targetId);
      const relation = await this.deps.repository.invitee(targetId);
      const listed = await this.deps.repository.page(targetId, 5, 0);
      const rewards = await this.deps.repository.rewards(targetId);
      const kit = await this.deps.repository.kitClaim(targetId);
      const lines = [
        `${this.deps.displayName(targetId)} ${targetId}`,
        `код ${code}`,
        relation
          ? `приглашён ${this.deps.displayName(relation.referrerId)}: ${relation.activeSeconds} с, ${relation.status}`
          : 'как приглашённый не участвует',
        `подтверждено ${listed.qualified} из ${listed.total}`,
        rewards.length === 0 ? 'наград нет' : rewards.map((row) => `${row.milestone} ${row.status} ${row.rank}`).join('; '),
        kit ? `кит ${kit.state}` : 'кита нет',
      ];
      void actorId;
      return lines.join('\n');
    } catch {
      return UNAVAILABLE;
    }
  }

  async devAddTime(actorId: string, targetId: string, seconds: number): Promise<string> {
    if (!this.deps?.devTools) return 'Команда выключена.';
    const add = Math.floor(seconds);
    if (!Number.isInteger(add) || add < 1 || add > REFERRAL_ACTIVE_SECONDS) {
      return `Укажите секунды от 1 до ${REFERRAL_ACTIVE_SECONDS}.`;
    }
    try {
      const result = await this.deps.repository.devAddSeconds(targetId, add, this.deps.now());
      if (!result.row) return 'У игрока нет принятого приглашения.';
      if (result.row.status === 'qualified') {
        await this.finishQualification(result.row, result.qualifiedCount);
      } else {
        const track = this.tracks.get(targetId);
        if (track) track.clock.committedSeconds = result.row.activeSeconds;
      }
      await this.deps.auditDev?.(actorId, 'referral.dev.addtime', targetId, `seconds=${add}`);
      return `Записано ${result.row.activeSeconds} с, статус ${result.row.status}.`;
    } catch {
      return UNAVAILABLE;
    }
  }

  allowRefresh(playerId: string): boolean {
    return this.allow(`refresh:${playerId}`, 1, REFRESH_MS);
  }

  private async preview(playerId: string, code: string): Promise<string> {
    const owner = await this.deps!.repository.codeOwner(code);
    if (!owner) return 'Реферальный код не найден.';
    if (owner === playerId) return 'Нельзя использовать собственный код.';
    const relation = await this.deps!.repository.invitee(playerId);
    if (relation) return 'Вы уже приняли приглашение.';
    return `Код ${code} — приглашение от ${this.deps!.displayName(owner)}. Нажмите «Принять приглашение».`;
  }

  private async kitStatus(playerId: string, relation: RelationRow | null): Promise<ReferralMenuState['kit']> {
    if (!relation) return { state: 'none', detail: 'Набор появится после принятия приглашения.' };
    const delivery = this.deps!.kitDelivery(playerId);
    if (delivery?.hasReceipt(relation.referralId)) {
      return { state: 'claimed', detail: 'Получен' };
    }
    const claim = await this.deps!.repository.kitClaim(playerId);
    if (claim?.state === 'claimed') return { state: 'claimed', detail: 'Получен' };
    const items = this.deps!.kitItems();
    if (!items || items.length === 0) {
      return { state: 'awaiting_setup', detail: 'Ожидает настройки' };
    }
    return { state: 'available', detail: 'Доступен' };
  }

  private remember(playerId: string, rows: RewardRow[]): void {
    const resolved = resolveEntitlements(rows, this.deps!.paidRank(playerId, this.deps!.now()), this.deps!.now());
    this.rewards.set(playerId, resolved.rows);
    this.ranks.delete(playerId);
    if (resolved.changed) this.scheduleRewardSave(playerId, resolved.rows);
    this.deps!.onBenefitsChanged(playerId);
  }

  private scheduleRewardSave(playerId: string, rows: readonly RewardEntitlement[]): void {
    const timer = setTimeout(() => {
      void this.persistRewards(playerId, rows);
    }, 0);
    timer.unref?.();
  }

  private async persistRewards(playerId: string, rows: readonly RewardEntitlement[]): Promise<void> {
    if (!this.deps) return;
    try {
      await this.deps.repository.saveRewards(rows);
      this.dbOk = true;
      this.ranks.delete(playerId);
      this.deps.onBenefitsChanged(playerId);
    } catch {
      this.dbOk = false;
    }
    void playerId;
  }

  private rankNote(playerId: string): string | undefined {
    const view = this.rankView(playerId);
    if (view.rank === 'default') return undefined;
    return view.rank === 'vip' ? 'Сейчас действует реферальный VIP или ранг не ниже него.' : 'Сейчас действует реферальный PREMIUM или ранг не ниже него.';
  }

  private async flushTrack(playerId: string): Promise<void> {
    const track = this.tracks.get(playerId);
    const deps = this.deps;
    if (!track || !deps || track.flushing) return;
    if (track.uncertain && track.inFlight) {
      track.flushing = true;
      try {
        const row = await deps.repository.invitee(playerId);
        track.clock.discardPendingSeconds(track.inFlight.delta);
        track.inFlight = null;
        track.uncertain = false;
        this.dbOk = true;
        if (!row || row.status === 'qualified') {
          this.tracks.delete(playerId);
          if (row?.status === 'qualified') await this.finishQualification(row, (await deps.repository.page(row.referrerId, 1, 0)).qualified);
          return;
        }
        track.clock.committedSeconds = row.activeSeconds;
      } catch {
        this.dbOk = false;
        return;
      } finally {
        const live = this.tracks.get(playerId);
        if (live) live.flushing = false;
      }
    }
    const live = this.tracks.get(playerId);
    if (!live || live.flushing) return;
    const delta = live.clock.pendingSeconds;
    if (delta <= 0) return;
    const expected = live.clock.committedSeconds;
    live.flushing = true;
    live.inFlight = { delta, expected };
    try {
      const result = await deps.repository.flush(live.referralId, expected, delta, deps.now());
      this.dbOk = true;
      live.inFlight = null;
      live.uncertain = false;
      if (!result.applied || !result.row) {
        if (result.applied === false && result.row) live.clock.committedSeconds = result.row.activeSeconds;
        if (!result.row || result.row.status === 'qualified') this.tracks.delete(playerId);
        return;
      }
      live.clock.committedSeconds = result.row.activeSeconds;
      live.clock.discardPendingSeconds(delta);
      if (result.row.status === 'qualified') {
        this.tracks.delete(playerId);
        await this.finishQualification(result.row, result.qualifiedCount);
      }
    } catch {
      live.uncertain = true;
      this.dbOk = false;
    } finally {
      const current = this.tracks.get(playerId);
      if (current) current.flushing = false;
    }
  }

  private async finishQualification(row: RelationRow, qualifiedCount: number): Promise<void> {
    const deps = this.deps;
    if (!deps) return;
    await this.lane(row.referrerId, async () => {
      const rewards = await deps.repository.ensureMilestones(row.referrerId, qualifiedCount, deps.now());
      this.remember(row.referrerId, rewards);
      const resolved = resolveEntitlements(rewards, deps.paidRank(row.referrerId, deps.now()), deps.now());
      if (resolved.changed) await deps.repository.saveRewards(resolved.rows);
      this.rewards.set(row.referrerId, resolved.rows);
      this.announceMilestone(row.referrerId, qualifiedCount, resolved.rows);
    });
    const inviteeKey = `invitee:${row.referralId}`;
    if (!this.announced.has(inviteeKey)) {
      this.announced.add(inviteeKey);
      deps.notify(row.inviteeId, 'Вы отыграли 3 часа. Приглашение подтверждено.');
      deps.notify(row.referrerId, `Друг подтвердил приглашение. Подтверждено: ${qualifiedCount}.`);
    }
  }

  private announceMilestone(referrerId: string, qualifiedCount: number, rows: readonly RewardRow[]): void {
    const tell = (milestone: ReferralMilestone, text: string): void => {
      if (qualifiedCount < (milestone === '3_confirmed' ? 3 : 5)) return;
      const key = `${referrerId}:${milestone}`;
      if (this.announced.has(key)) return;
      if (!rows.some((row) => row.milestone === milestone)) return;
      this.announced.add(key);
      const row = rows.find((entry) => entry.milestone === milestone);
      const banked = row && row.status !== 'active';
      this.deps?.notify(referrerId, banked ? `${text} Награда сохранена и включится, когда не будет более высокого ранга.` : text);
    };
    if (qualifiedCount === 3) tell('3_confirmed', 'Вам начислен VIP на 7 дней.');
    if (qualifiedCount === 5) tell('5_confirmed', 'Вам начислен PREMIUM на 7 дней.');
  }

  private arm(delay: number): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const ids = [...this.tracks.keys()];
      for (const id of ids) void this.lane(id, () => this.flushTrack(id));
      if (this.tracks.size > 0) this.arm(30_000);
    }, delay);
    this.timer.unref?.();
  }

  private lane(playerId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.lanes.get(playerId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.lanes.set(playerId, run.then(() => undefined, () => undefined));
    return run;
  }

  private allow(key: string, limit: number, windowMs: number): boolean {
    const now = this.deps?.now() ?? Date.now();
    const stamps = (this.hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (stamps.length >= limit) {
      this.hits.set(key, stamps);
      return false;
    }
    stamps.push(now);
    this.hits.set(key, stamps);
    return true;
  }
}

function emptyMenu(reason: string): ReferralMenuState {
  return {
    available: false,
    activityNote: 'Активная игра засчитывается на Анархии.',
    unavailableReason: reason,
    qualifiedCount: 0,
    invitedCount: 0,
    invitees: [],
    page: 1,
    pageCount: 1,
    rewards: [],
    kit: { state: 'none', detail: '' },
  };
}

function rewardLines(
  rows: readonly RewardRow[],
  qualified: number,
  now: number,
  paid: EffectiveRank,
): ReferralMenuState['rewards'] {
  const resolved = resolveEntitlements(rows, paid, now).rows;
  const milestones: ReferralMilestone[] = ['3_confirmed', '5_confirmed'];
  return milestones.map((milestone) => {
    const row = resolved.find((entry) => entry.milestone === milestone);
    const title = referralRewardTitle(milestone);
    if (!row) {
      const left = friendsUntilMilestone(qualified, milestone);
      return { milestone, title, detail: left === 0 ? 'ожидает подтверждения' : `осталось ${left}` };
    }
    if (row.status === 'active') return { milestone, title, detail: 'получено' };
    if (row.status === 'expired') return { milestone, title, detail: 'срок истёк' };
    if (row.status === 'paused' || row.status === 'pending') return { milestone, title, detail: 'сохранено' };
    return { milestone, title, detail: 'получено' };
  });
}

export const REFERRAL_STARTER_KIT = REFERRAL_KIT_NAME;
