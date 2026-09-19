export const NOTIFICATION_CATEGORIES = ['friends', 'clans', 'auction', 'trade'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationCounts {
  friends: number;
  clans: number;
  auction: number;
  trade: number;
}

export const NOTIFICATION_BADGE_MAX = 99;

export function emptyNotificationCounts(): NotificationCounts {
  return { friends: 0, clans: 0, auction: 0, trade: 0 };
}

export function isNotificationCategory(value: string | undefined): value is NotificationCategory {
  return value !== undefined && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function notificationCategoryForButton(id: string): NotificationCategory | undefined {
  return isNotificationCategory(id) ? id : undefined;
}

export function notificationCategoryForScreen(screen: string): NotificationCategory | undefined {
  if (screen === 'friends' || screen === 'friend-delete-confirm') return 'friends';
  if (screen === 'clans') return 'clans';
  if (screen === 'auction' || screen === 'auction-history') return 'auction';
  if (screen === 'trade') return 'trade';
  return undefined;
}

export function normalizeNotificationCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Yellow-square label. Hidden at 0; compact `99+` past two digits. */
export function formatNotificationBadge(count: number): string | undefined {
  const n = normalizeNotificationCount(count);
  if (n <= 0) return undefined;
  if (n > NOTIFICATION_BADGE_MAX) return `${NOTIFICATION_BADGE_MAX}+`;
  return String(n);
}
