export const FRIENDS_PLUGIN_NAME = 'friends';
export const FRIENDS_MAX = 50;
export const FRIENDS_SELF_ERROR = 'Нельзя добавить себя в друзья.';
export const FRIENDS_UNKNOWN_ERROR = 'Игрок с таким ником не найден.';
export const FRIENDS_ALREADY_ERROR = 'Этот игрок уже у вас в друзьях.';
export const FRIENDS_DUPLICATE_REQUEST_ERROR = 'Заявка этому игроку уже отправлена.';
export const FRIENDS_LIMIT_ERROR = `Можно добавить не больше ${FRIENDS_MAX} друзей.`;
export const FRIENDS_REQUEST_MISSING_ERROR = 'Заявка не найдена.';
export const FRIENDS_NOT_FRIEND_ERROR = 'Этот игрок не в списке друзей.';
export const FRIENDS_OFFLINE_ERROR = 'Игрок не в сети.';
export const FRIENDS_TELEPORT_DENIED_ERROR = 'Этот игрок запретил телепортацию друзей.';
export const FRIENDS_EMPTY_NAME_ERROR = 'Введите ник игрока.';

export interface FriendRecord {
  readonly playerId: string;
  readonly createdAt: number;
}

export interface FriendRequest {
  readonly requestId: string;
  readonly fromPlayerId: string;
  readonly toPlayerId: string;
  readonly createdAt: number;
}

export interface FriendsPlayerState {
  friends: FriendRecord[];
  /** Friends may teleport to this player only when true. Default false. */
  allowFriendTeleport: boolean;
}

export interface FriendsStore {
  players: Record<string, FriendsPlayerState>;
  requests: FriendRequest[];
}
