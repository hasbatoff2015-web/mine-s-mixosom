export const FRIEND_PLUGIN_NAME = 'friends';
export const FRIEND_MAX = 50;

export const FRIEND_SELF_ERROR = 'Нельзя добавить самого себя в друзья.';
export const FRIEND_MISSING_PLAYER_ERROR = 'Игрок не найден.';
export const FRIEND_ALREADY_ERROR = 'Этот игрок уже у вас в друзьях.';
export const FRIEND_REQUEST_EXISTS_ERROR = 'Заявка уже отправлена.';
export const FRIEND_LIMIT_ERROR = 'Достигнут лимит друзей: 50.';
export const FRIEND_TARGET_LIMIT_ERROR = 'У этого игрока нет места для новых друзей.';
export const FRIEND_NOT_FRIEND_ERROR = 'Этот игрок не в списке друзей.';
export const FRIEND_REQUEST_MISSING_ERROR = 'Заявка не найдена.';
export const FRIEND_OFFLINE_ERROR = 'Игрок не в сети.';
export const FRIEND_TELEPORT_DENIED_ERROR = 'Этот игрок запретил телепортацию друзей.';
export const FRIEND_BUSY_ERROR = 'Подождите, действие уже выполняется.';

export function sortFriends<T extends { readonly online: boolean; readonly name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    return left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' });
  });
}
