/** Russian player-facing text. Add a language table later without hunting call sites. */
export const playerText = {
  noPermission: 'Недостаточно прав для выполнения этой команды.',
  claimBreak: 'Здесь нельзя ломать блоки: территория занята.',
  claimPlace: 'Здесь нельзя ставить блоки: территория занята.',
  gamemodeUsage: 'Использование: /gamemode <survival|creative|spectator|0|1|2>',
  playerNotFound: 'Игрок не найден.',
  playerOffline: (name: string) => `Игрок «${name}» не в сети.`,
  tpaSelf: 'Нельзя телепортироваться к себе.',
  tpaDone: (name: string) => `Вы телепортированы к ${name}.`,
  tpahereDone: (name: string) => `${name} телепортирован к вам.`,
  movedByOperator: 'Оператор телепортировал вас к себе.',
  commandRetired: 'Эта команда больше не используется.',
  spectatorDenied: 'В режиме наблюдателя это действие недоступно.',
  petBeeDenied: 'Для призыва пчёлки нужна привилегия BOSS.',
  petCreeperDenied: 'Для призыва мини-крипера нужна привилегия TITAN.',
  petBeeReady: 'Летает рядом.',
  petCreeperReady: 'Ходит рядом.',
  petBeeSummon: 'Призвать пчёлку',
  petBeeDismiss: 'Отозвать пчёлку',
  petCreeperSummon: 'Призвать мини-крипера',
  petCreeperDismiss: 'Отозвать мини-крипера',
  petActive: 'Сейчас рядом.',
  petWorldCap: 'На сервере уже максимум декоративных питомцев.',
  spawnpetUsage: 'Usage: /spawnpet <bee|creeper|off>',
  gamemodeSet: (label: string) => `Режим игры: ${label}.`,
} as const;

export function gamemodeLabel(mode: string): string {
  if (mode === 'creative') return 'Творчество';
  if (mode === 'spectator') return 'Наблюдатель';
  return 'Выживание';
}
