import { MAX_CHAT_LENGTH, MAX_PLAYER_NAME_LENGTH, PROTOCOL_VERSION } from './config';

export type GameMode = 'survival' | 'creative';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type Vec3 = readonly [number, number, number];

export interface PlayerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly health: number;
  readonly gamemode: GameMode;
  readonly sneaking: boolean;
  readonly sprinting: boolean;
  readonly onGround: boolean;
  readonly selectedSlot: number;
}

export interface RemotePlayerInfo {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

export type WorldModifications = Record<string, Record<string, number>>;
export type WorldBlockStates = Record<string, unknown>;

export interface ClientJoinMessage {
  readonly type: 'join';
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly name?: string;
  readonly sessionToken?: string;
}

export interface ClientInputMessage {
  readonly type: 'input';
  readonly seq: number;
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly sprint: boolean;
  readonly descend: boolean;
  readonly flySprint: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly selectedSlot: number;
}

export interface ClientBreakBlockMessage {
  readonly type: 'break_block';
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ClientPlaceBlockMessage {
  readonly type: 'place_block';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId?: number;
}

export interface ClientChatMessage {
  readonly type: 'chat';
  readonly text: string;
}

export interface ClientViewMessage {
  readonly type: 'view';
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
}

export interface ClientPingMessage {
  readonly type: 'ping';
  readonly t: number;
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientBreakBlockMessage
  | ClientPlaceBlockMessage
  | ClientChatMessage
  | ClientViewMessage
  | ClientPingMessage;

export interface ServerWelcomeMessage {
  readonly type: 'welcome';
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly playerId: string;
  readonly sessionToken: string;
  readonly name: string;
  readonly seed: string;
  readonly worldId: string;
  readonly timeOfDay: number;
  readonly spawn: Vec3;
  readonly you: PlayerSnapshot;
  readonly inventory: unknown;
  readonly players: readonly RemotePlayerInfo[];
  readonly modifications: WorldModifications;
  readonly blockStates: WorldBlockStates;
  readonly online: number;
  readonly maxPlayers: number;
  readonly serverName: string;
}

export interface ServerPlayerJoinedMessage {
  readonly type: 'player_joined';
  readonly player: RemotePlayerInfo;
}

export interface ServerPlayerLeftMessage {
  readonly type: 'player_left';
  readonly playerId: string;
}

export interface ServerPlayerStateMessage {
  readonly type: 'player_state';
  readonly tick: number;
  readonly players: readonly PlayerSnapshot[];
}

export interface ServerBlockUpdateMessage {
  readonly type: 'block_update';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface ServerBlockResultMessage {
  readonly type: 'block_result';
  readonly ok: boolean;
  readonly action: 'break' | 'place';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly reason?: string;
}

export interface ServerChunkMessage {
  readonly type: 'chunk_data';
  readonly cx: number;
  readonly cz: number;
  /** Modification delta for this chunk only (existing save representation). */
  readonly modifications: Record<string, number>;
}

export interface ServerUnloadChunkMessage {
  readonly type: 'unload_chunk';
  readonly cx: number;
  readonly cz: number;
}

export interface ServerChatMessage {
  readonly type: 'chat';
  readonly from: string;
  readonly playerId: string;
  readonly text: string;
  readonly kind: 'player' | 'system' | 'command' | 'error';
}

export interface ServerErrorMessage {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export interface ServerPongMessage {
  readonly type: 'pong';
  readonly t: number;
}

export interface ServerStatusMessage {
  readonly type: 'status';
  readonly online: number;
  readonly maxPlayers: number;
}

export interface ServerInventoryMessage {
  readonly type: 'inventory';
  readonly inventory: unknown;
  readonly selectedSlot: number;
  readonly gamemode: GameMode;
}

export type ServerMessage =
  | ServerWelcomeMessage
  | ServerPlayerJoinedMessage
  | ServerPlayerLeftMessage
  | ServerPlayerStateMessage
  | ServerBlockUpdateMessage
  | ServerBlockResultMessage
  | ServerChunkMessage
  | ServerUnloadChunkMessage
  | ServerChatMessage
  | ServerErrorMessage
  | ServerPongMessage
  | ServerStatusMessage
  | ServerInventoryMessage;

export const CLIENT_MESSAGE_TYPES = [
  'join',
  'input',
  'break_block',
  'place_block',
  'chat',
  'view',
  'ping',
] as const satisfies readonly ClientMessage['type'][];

export const SERVER_MESSAGE_TYPES = [
  'welcome',
  'player_joined',
  'player_left',
  'player_state',
  'block_update',
  'block_result',
  'chunk_data',
  'unload_chunk',
  'chat',
  'error',
  'pong',
  'status',
  'inventory',
] as const satisfies readonly ServerMessage['type'][];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bool(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
  if (!/^[A-Za-z0-9_А-Яа-яЁё -]+$/.test(trimmed)) return undefined;
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseClientMessage(raw: unknown): ClientMessage | { readonly error: string } {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { error: 'message must be an object with a type' };
  }
  switch (raw.type) {
    case 'join': {
      if (raw.protocol !== PROTOCOL_VERSION) {
        return { error: `unsupported protocol ${String(raw.protocol)}` };
      }
      const name = sanitizeName(raw.name);
      const sessionToken = typeof raw.sessionToken === 'string' ? raw.sessionToken.slice(0, 80) : undefined;
      return {
        type: 'join',
        protocol: PROTOCOL_VERSION,
        ...(name ? { name } : {}),
        ...(sessionToken ? { sessionToken } : {}),
      };
    }
    case 'input': {
      if (!finite(raw.seq) || !Number.isInteger(raw.seq) || raw.seq < 0 || raw.seq > 2_147_483_647) {
        return { error: 'input.seq invalid' };
      }
      if (!finite(raw.forward) || !finite(raw.right) || !finite(raw.yaw) || !finite(raw.pitch)) {
        return { error: 'input numbers invalid' };
      }
      if (!bool(raw.jump) || !bool(raw.sneak) || !bool(raw.sprint) || !bool(raw.descend) || !bool(raw.flySprint)) {
        return { error: 'input flags invalid' };
      }
      if (!finite(raw.selectedSlot) || !Number.isInteger(raw.selectedSlot)) {
        return { error: 'input.selectedSlot invalid' };
      }
      return {
        type: 'input',
        seq: raw.seq,
        forward: clampNumber(raw.forward, -1, 1),
        right: clampNumber(raw.right, -1, 1),
        jump: raw.jump,
        sneak: raw.sneak,
        sprint: raw.sprint,
        descend: raw.descend,
        flySprint: raw.flySprint,
        yaw: raw.yaw,
        pitch: clampNumber(raw.pitch, -Math.PI / 2, Math.PI / 2),
        selectedSlot: clampNumber(Math.floor(raw.selectedSlot), 0, 8),
      };
    }
    case 'break_block':
    case 'place_block': {
      if (!Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) {
        return { error: 'block coordinates must be integers' };
      }
      if (!finite(raw.x) || !finite(raw.y) || !finite(raw.z)) {
        return { error: 'block coordinates invalid' };
      }
      if (raw.type === 'break_block') {
        return { type: 'break_block', x: raw.x, y: raw.y, z: raw.z };
      }
      const blockId = raw.blockId === undefined ? undefined : raw.blockId;
      if (blockId !== undefined && (!Number.isInteger(blockId) || !finite(blockId))) {
        return { error: 'place_block.blockId invalid' };
      }
      return {
        type: 'place_block',
        x: raw.x,
        y: raw.y,
        z: raw.z,
        ...(blockId === undefined ? {} : { blockId }),
      };
    }
    case 'chat': {
      if (typeof raw.text !== 'string') return { error: 'chat.text required' };
      const text = raw.text.replace(/\s+$/g, '').slice(0, MAX_CHAT_LENGTH);
      if (!text) return { error: 'chat.text empty' };
      return { type: 'chat', text };
    }
    case 'view': {
      if (!Number.isInteger(raw.cx) || !Number.isInteger(raw.cz) || !Number.isInteger(raw.radius)) {
        return { error: 'view integers required' };
      }
      if (!finite(raw.cx) || !finite(raw.cz) || !finite(raw.radius)) {
        return { error: 'view numbers invalid' };
      }
      return {
        type: 'view',
        cx: raw.cx,
        cz: raw.cz,
        radius: clampNumber(raw.radius, 1, 8),
      };
    }
    case 'ping': {
      if (!finite(raw.t)) return { error: 'ping.t invalid' };
      return { type: 'ping', t: raw.t };
    }
    default:
      return { error: `unknown message type ${raw.type}` };
  }
}

export function parseServerMessage(raw: unknown): ServerMessage | { readonly error: string } {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { error: 'message must be an object with a type' };
  }
  if (!(SERVER_MESSAGE_TYPES as readonly string[]).includes(raw.type)) {
    return { error: `unknown message type ${raw.type}` };
  }
  switch (raw.type) {
    case 'player_state': {
      if (!finite(raw.tick) || !Number.isInteger(raw.tick) || raw.tick < 0 || !Array.isArray(raw.players)) {
        return { error: 'player_state invalid' };
      }
      return raw as unknown as ServerPlayerStateMessage;
    }
    case 'block_update': {
      if (
        !finite(raw.x) || !finite(raw.y) || !finite(raw.z) || !finite(raw.blockId)
        || !Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z) || !Number.isInteger(raw.blockId)
      ) {
        return { error: 'block_update invalid' };
      }
      return {
        type: 'block_update',
        x: raw.x,
        y: raw.y,
        z: raw.z,
        blockId: raw.blockId,
      };
    }
    case 'block_result': {
      if (!bool(raw.ok) || (raw.action !== 'break' && raw.action !== 'place')) {
        return { error: 'block_result invalid' };
      }
      if (!finite(raw.x) || !finite(raw.y) || !finite(raw.z) || !Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) {
        return { error: 'block_result coordinates invalid' };
      }
      const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 64) : undefined;
      return {
        type: 'block_result',
        ok: raw.ok,
        action: raw.action,
        x: raw.x,
        y: raw.y,
        z: raw.z,
        ...(reason ? { reason } : {}),
      };
    }
    default:
      return raw as unknown as ServerMessage;
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
