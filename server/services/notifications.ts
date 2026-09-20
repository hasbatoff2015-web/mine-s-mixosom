import type { JsonFileStore } from './jsonStore';
import {
  emptyNotificationCounts,
  isNotificationCategory,
  normalizeNotificationCount,
  type NotificationCategory,
  type NotificationCounts,
} from '../../shared/notifications';

export const NOTIFICATIONS_PLUGIN_NAME = 'notifications';

interface NotificationFile {
  players: Record<string, Partial<NotificationCounts>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCounts(raw: unknown): NotificationCounts {
  const source = isRecord(raw) ? raw : {};
  return {
    friends: normalizeNotificationCount(source.friends),
    clans: normalizeNotificationCount(source.clans),
    auction: normalizeNotificationCount(source.auction),
    trade: normalizeNotificationCount(source.trade),
  };
}

/**
 * Server-authoritative unread badges for the in-game menu.
 * One increment per domain event via `notify()` — never from chat or client claims.
 */
export class NotificationService {
  private players = new Map<string, NotificationCounts>();

  constructor(private readonly store: JsonFileStore) {
    this.load();
  }

  load(): void {
    const file = this.store.load<NotificationFile>('notifications/unread', { players: {} });
    this.players.clear();
    if (!isRecord(file) || !isRecord(file.players)) return;
    for (const [playerId, raw] of Object.entries(file.players)) {
      if (!playerId) continue;
      this.players.set(playerId, parseCounts(raw));
    }
  }

  persist(): void {
    const players: NotificationFile['players'] = {};
    for (const [playerId, counts] of this.players) {
      if (counts.friends === 0 && counts.clans === 0 && counts.auction === 0 && counts.trade === 0) continue;
      players[playerId] = { ...counts };
    }
    this.store.save('notifications/unread', { players });
  }

  counts(playerId: string): NotificationCounts {
    const current = this.players.get(playerId);
    return current ? { ...current } : emptyNotificationCounts();
  }

  notify(playerId: string, category: NotificationCategory): number {
    if (!playerId || !isNotificationCategory(category)) return 0;
    const current = this.ensure(playerId);
    current[category] += 1;
    this.persist();
    return current[category];
  }

  clear(playerId: string, category: NotificationCategory): void {
    if (!playerId || !isNotificationCategory(category)) return;
    const current = this.players.get(playerId);
    if (!current || current[category] === 0) return;
    current[category] = 0;
    this.persist();
  }

  private ensure(playerId: string): NotificationCounts {
    const current = this.players.get(playerId);
    if (current) return current;
    const created = emptyNotificationCounts();
    this.players.set(playerId, created);
    return created;
  }
}
