export const GAME_MENU_MAX_CLAIMS = 4;

export const GAME_MENU_BUTTONS = [
  { id: 'spawn', label: 'Спавн' },
  { id: 'homes', label: 'Дома' },
  { id: 'friends', label: 'Друзья' },
  { id: 'clans', label: 'Кланы' },
  { id: 'claims', label: 'Приваты' },
  { id: 'trade', label: 'Обмен' },
  { id: 'auction', label: 'Аукцион' },
] as const;

export type GameMenuButtonId = (typeof GAME_MENU_BUTTONS)[number]['id'];

export type GameMenuScreen =
  | 'root'
  | 'homes'
  | 'home-delete-confirm'
  | 'friends'
  | 'friend-delete-confirm'
  | 'clans'
  | 'claims'
  | 'claim-settings'
  | 'claim-delete-confirm'
  | 'trade'
  | 'auction'
  | 'closed';

export function showsMenuBack(screen: GameMenuScreen): boolean {
  return screen !== 'root' && screen !== 'closed';
}

export function claimAnchorTitle(block: string | undefined, name: string): string {
  if (block === 'diamond_block') return name.match(/^\d+$/) ? 'Алмазный приват' : name;
  if (block === 'gold_block') return name.match(/^\d+$/) ? 'Золотой приват' : name;
  if (block === 'iron_block') return name.match(/^\d+$/) ? 'Железный приват' : name;
  return name;
}
