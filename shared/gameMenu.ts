export const GAME_MENU_MAX_CLAIMS = 4;
export const CLAIM_MAX_OWNED = GAME_MENU_MAX_CLAIMS;

export const GAME_MENU_BUTTONS = [
  { id: 'spawn', label: 'Спавн', icon: 'icon_spawn.png' },
  { id: 'homes', label: 'Дома', icon: 'icon_homes.png' },
  { id: 'friends', label: 'Друзья', icon: 'icon_friends.png' },
  { id: 'clans', label: 'Кланы', icon: 'icon_clans.png' },
  { id: 'claims', label: 'Приваты', icon: 'icon_claims.png' },
  { id: 'trade', label: 'Обмен', icon: 'icon_trade.png' },
  { id: 'auction', label: 'Аукцион', icon: 'icon_auction.png' },
  { id: 'rating', label: 'Рейтинг', icon: 'icon_rating.png' },
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
  | 'auction-history'
  | 'rating'
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
