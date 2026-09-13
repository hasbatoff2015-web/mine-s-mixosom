export const MENU_PLUGIN_NAME = 'menu';
export const CLAIM_MAX_OWNED = 4;

export type MenuScreenKind =
  | 'main'
  | 'homes'
  | 'home-delete-confirm'
  | 'friends'
  | 'friend-delete-confirm'
  | 'clans'
  | 'claims'
  | 'claim-detail'
  | 'claim-delete-confirm'
  | 'trade'
  | 'trade-session'
  | 'auction'
  | 'closed';

export const MENU_SCREENS: readonly MenuScreenKind[] = [
  'main',
  'homes',
  'home-delete-confirm',
  'friends',
  'friend-delete-confirm',
  'clans',
  'claims',
  'claim-detail',
  'claim-delete-confirm',
  'trade',
  'trade-session',
  'auction',
  'closed',
];

export type MenuActionKind =
  | 'open'
  | 'close'
  | 'back'
  | 'spawn'
  | 'open_homes'
  | 'set_home_name'
  | 'create_home'
  | 'teleport_home'
  | 'delete_home'
  | 'confirm_delete_home'
  | 'cancel_delete_home'
  | 'open_friends'
  | 'set_teleport_allowed'
  | 'set_friend_name'
  | 'send_friend_request'
  | 'accept_friend'
  | 'reject_friend'
  | 'teleport_friend'
  | 'remove_friend'
  | 'confirm_remove_friend'
  | 'cancel_remove_friend'
  | 'open_clans'
  | 'open_my_clan'
  | 'open_clan_list'
  | 'open_create_clan'
  | 'open_claims'
  | 'open_claim'
  | 'set_claim_name'
  | 'save_claim_name'
  | 'set_claim_pvp'
  | 'set_claim_member_name'
  | 'add_claim_member'
  | 'remove_claim_member'
  | 'delete_claim'
  | 'confirm_delete_claim'
  | 'cancel_delete_claim'
  | 'open_trade'
  | 'set_trade_name'
  | 'send_trade'
  | 'accept_trade_invite'
  | 'reject_trade_invite'
  | 'select_inventory_slot'
  | 'click_offer_slot'
  | 'set_trade_money'
  | 'ready_trade'
  | 'accept_trade'
  | 'cancel_trade'
  | 'open_auction'
  | 'open_auction_browse'
  | 'open_auction_list'
  | 'open_auction_sell';

export const MENU_ACTIONS: readonly MenuActionKind[] = [
  'open',
  'close',
  'back',
  'spawn',
  'open_homes',
  'set_home_name',
  'create_home',
  'teleport_home',
  'delete_home',
  'confirm_delete_home',
  'cancel_delete_home',
  'open_friends',
  'set_teleport_allowed',
  'set_friend_name',
  'send_friend_request',
  'accept_friend',
  'reject_friend',
  'teleport_friend',
  'remove_friend',
  'confirm_remove_friend',
  'cancel_remove_friend',
  'open_clans',
  'open_my_clan',
  'open_clan_list',
  'open_create_clan',
  'open_claims',
  'open_claim',
  'set_claim_name',
  'save_claim_name',
  'set_claim_pvp',
  'set_claim_member_name',
  'add_claim_member',
  'remove_claim_member',
  'delete_claim',
  'confirm_delete_claim',
  'cancel_delete_claim',
  'open_trade',
  'set_trade_name',
  'send_trade',
  'accept_trade_invite',
  'reject_trade_invite',
  'select_inventory_slot',
  'click_offer_slot',
  'set_trade_money',
  'ready_trade',
  'accept_trade',
  'cancel_trade',
  'open_auction',
  'open_auction_browse',
  'open_auction_list',
  'open_auction_sell',
];

export function isMenuScreen(value: string): value is MenuScreenKind {
  return (MENU_SCREENS as readonly string[]).includes(value);
}

export function isMenuAction(value: string): value is MenuActionKind {
  return (MENU_ACTIONS as readonly string[]).includes(value);
}

export function showsMenuBack(screen: MenuScreenKind): boolean {
  return screen !== 'main' && screen !== 'closed' && screen !== 'trade-session';
}

export const CLAIM_LIMIT_ERROR = 'У вас уже максимальное количество приватов: 4.';
export const CLAIM_MISSING_ERROR = 'Приват не найден.';
export const CLAIM_NAME_TAKEN_ERROR = 'Приват с таким названием уже есть.';
export const CLAIM_MEMBER_MISSING_ERROR = 'Игрок не найден.';
export const CLAIM_MEMBER_SELF_ERROR = 'Нельзя добавить самого себя. Вы уже владелец привата.';
export const CLAIM_RENAME_ERROR = 'Недопустимое название привата.';
