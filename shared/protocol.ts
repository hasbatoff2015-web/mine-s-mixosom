import { MAX_CHAT_LENGTH, MAX_PLAYER_NAME_LENGTH, PROTOCOL_VERSION } from './config';

export type GameMode = 'survival' | 'creative';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type Vec3 = readonly [number, number, number];

export type ContainerKind = 'inventory' | 'crafting-table' | 'chest' | 'furnace';

export type InventoryActionKind =
  | 'click'
  | 'drop_selected'
  | 'drop_cursor'
  | 'select'
  | 'open'
  | 'close'
  | 'recipe';

export type EntityKind = 'item' | 'mob' | 'minecart' | 'tnt' | 'arrow' | 'falling';

export type VehicleAction = 'enter' | 'exit' | 'steer';

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
  readonly invisible?: boolean;
  readonly onFire?: boolean;
  readonly hunger?: number;
  readonly armor?: number;
  readonly ridingEntityId?: string;
  readonly dead?: boolean;
  /** Last input seq used for this pose (latest movement state that tick). */
  readonly inputSeq?: number;
  /** Creative flight. Omitted by older servers; prediction keeps local isFlying. */
  readonly flying?: boolean;
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

export interface EffectSnapshot {
  readonly id: string;
  readonly amplifier: number;
  readonly remainingTicks: number;
}

export interface EntitySnapshot {
  readonly id: string;
  readonly kind: EntityKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw?: number;
  readonly pitch?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly vz?: number;
  readonly itemId?: string;
  readonly count?: number;
  readonly mobKind?: string;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly onFire?: boolean;
  readonly hurt?: boolean;
  readonly invisible?: boolean;
  readonly variant?: string;
  readonly primed?: boolean;
  readonly fuse?: number;
  readonly passengerId?: string;
  readonly state?: string;
  readonly blockId?: number;
}

export type NetworkEntityEventKind = 'hurt' | 'death' | 'projectile_spawn' | 'projectile_hit';

export interface NetworkEntityEvent {
  readonly entityId: string;
  readonly kind: NetworkEntityEventKind;
}

export type NetworkBlockAttachment = 'floor' | 'wall' | 'ceiling';
export type NetworkHorizontalFacing = 'north' | 'south' | 'east' | 'west';
export type NetworkRailShape =
  | 'north_south'
  | 'east_west'
  | 'north_east'
  | 'north_west'
  | 'south_east'
  | 'south_west'
  | 'ascending_north'
  | 'ascending_south'
  | 'ascending_east'
  | 'ascending_west';

/** Subset of `BlockRenderState` that travels on live block packets. */
export interface NetworkBlockState {
  readonly powered?: boolean;
  readonly power?: number;
  readonly attachment?: NetworkBlockAttachment;
  readonly facing?: NetworkHorizontalFacing;
  readonly open?: boolean;
  readonly half?: 'lower' | 'upper';
  readonly hinge?: 'left' | 'right';
  readonly slabType?: 'bottom' | 'top' | 'double';
  readonly stairHalf?: 'bottom' | 'top';
  readonly fluidLevel?: number;
  readonly fluidFalling?: boolean;
  readonly railShape?: NetworkRailShape;
}

export interface BlockChange {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: NetworkBlockState;
}

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
  readonly mining?: boolean;
  readonly use?: boolean;
  readonly vehicleForward?: number;
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

export interface ClientInventoryActionMessage {
  readonly type: 'inventory_action';
  readonly action: InventoryActionKind;
  readonly key?: string;
  readonly button?: 'left' | 'right';
  readonly shift?: boolean;
  readonly slot?: number;
  readonly count?: number;
  readonly kind?: ContainerKind;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly recipeId?: string;
}

export interface ClientCraftMessage {
  readonly type: 'craft';
  readonly shift?: boolean;
}

export interface ClientInteractMessage {
  readonly type: 'interact';
}

export interface ClientAttackMessage {
  readonly type: 'attack';
}

export interface ClientPickupMessage {
  readonly type: 'pickup';
  readonly entityId?: string;
}

export interface ClientVehicleInputMessage {
  readonly type: 'vehicle_input';
  readonly action: VehicleAction;
  readonly entityId?: string;
  readonly forward?: number;
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientBreakBlockMessage
  | ClientPlaceBlockMessage
  | ClientChatMessage
  | ClientViewMessage
  | ClientPingMessage
  | ClientInventoryActionMessage
  | ClientCraftMessage
  | ClientInteractMessage
  | ClientAttackMessage
  | ClientPickupMessage
  | ClientVehicleInputMessage;

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
  readonly state?: NetworkBlockState;
}

export interface ServerBlockBatchMessage {
  readonly type: 'block_batch';
  readonly changes: readonly BlockChange[];
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
  readonly cursor?: unknown;
  readonly craftSlots?: unknown;
  readonly window?: {
    readonly kind: ContainerKind;
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
    readonly slots?: unknown;
  };
}

export interface ServerHealthMessage {
  readonly type: 'health';
  readonly health: number;
  readonly hunger: number;
  readonly saturation: number;
  readonly absorption: number;
  readonly air: number;
  readonly armor: number;
  readonly fire: boolean;
  readonly dead: boolean;
}

export interface ServerEffectsMessage {
  readonly type: 'effects';
  readonly effects: readonly EffectSnapshot[];
}

export interface ServerEntitySnapshotMessage {
  readonly type: 'entity_snapshot';
  readonly tick: number;
  readonly entities: readonly EntitySnapshot[];
}

export interface ServerEntityEventMessage {
  readonly type: 'entity_event';
  readonly tick: number;
  readonly events: readonly NetworkEntityEvent[];
}

export interface ServerCommandResultMessage {
  readonly type: 'command_result';
  readonly ok: boolean;
  readonly name: string;
  readonly lines: readonly string[];
}

export interface ServerTimeMessage {
  readonly type: 'time';
  readonly timeOfDay: number;
}

export type ServerMessage =
  | ServerWelcomeMessage
  | ServerPlayerJoinedMessage
  | ServerPlayerLeftMessage
  | ServerPlayerStateMessage
  | ServerBlockUpdateMessage
  | ServerBlockBatchMessage
  | ServerBlockResultMessage
  | ServerChunkMessage
  | ServerUnloadChunkMessage
  | ServerChatMessage
  | ServerErrorMessage
  | ServerPongMessage
  | ServerStatusMessage
  | ServerInventoryMessage
  | ServerHealthMessage
  | ServerEffectsMessage
  | ServerEntitySnapshotMessage
  | ServerEntityEventMessage
  | ServerCommandResultMessage
  | ServerTimeMessage;

export const CLIENT_MESSAGE_TYPES = [
  'join',
  'input',
  'break_block',
  'place_block',
  'chat',
  'view',
  'ping',
  'inventory_action',
  'craft',
  'interact',
  'attack',
  'pickup',
  'vehicle_input',
] as const satisfies readonly ClientMessage['type'][];

export const SERVER_MESSAGE_TYPES = [
  'welcome',
  'player_joined',
  'player_left',
  'player_state',
  'block_update',
  'block_batch',
  'block_result',
  'chunk_data',
  'unload_chunk',
  'chat',
  'error',
  'pong',
  'status',
  'inventory',
  'health',
  'effects',
  'entity_snapshot',
  'entity_event',
  'command_result',
  'time',
] as const satisfies readonly ServerMessage['type'][];

const INVENTORY_ACTIONS: readonly InventoryActionKind[] = [
  'click', 'drop_selected', 'drop_cursor', 'select', 'open', 'close', 'recipe',
];

const CONTAINER_KINDS: readonly ContainerKind[] = [
  'inventory', 'crafting-table', 'chest', 'furnace',
];

const VEHICLE_ACTIONS: readonly VehicleAction[] = ['enter', 'exit', 'steer'];

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

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || !finite(value)) return undefined;
  return value;
}

function optionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

const NETWORK_ATTACHMENTS: ReadonlySet<string> = new Set(['floor', 'wall', 'ceiling']);
const NETWORK_FACINGS: ReadonlySet<string> = new Set(['north', 'south', 'east', 'west']);
const NETWORK_RAIL_SHAPES: ReadonlySet<string> = new Set([
  'north_south', 'east_west', 'north_east', 'north_west', 'south_east', 'south_west',
  'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west',
]);

export function parseNetworkBlockState(raw: unknown): NetworkBlockState | undefined {
  if (!isRecord(raw)) return undefined;
  const state: {
    powered?: boolean;
    power?: number;
    attachment?: NetworkBlockAttachment;
    facing?: NetworkHorizontalFacing;
    open?: boolean;
    half?: 'lower' | 'upper';
    hinge?: 'left' | 'right';
    slabType?: 'bottom' | 'top' | 'double';
    stairHalf?: 'bottom' | 'top';
    fluidLevel?: number;
    fluidFalling?: boolean;
    railShape?: NetworkRailShape;
  } = {};
  if (typeof raw.powered === 'boolean') state.powered = raw.powered;
  if (Number.isInteger(raw.power) && finite(raw.power)) {
    state.power = clampNumber(Math.floor(raw.power), 0, 15);
  }
  if (typeof raw.attachment === 'string' && NETWORK_ATTACHMENTS.has(raw.attachment)) {
    state.attachment = raw.attachment as NetworkBlockAttachment;
  }
  if (typeof raw.facing === 'string' && NETWORK_FACINGS.has(raw.facing)) {
    state.facing = raw.facing as NetworkHorizontalFacing;
  }
  if (typeof raw.open === 'boolean') state.open = raw.open;
  if (raw.half === 'lower' || raw.half === 'upper') state.half = raw.half;
  if (raw.hinge === 'left' || raw.hinge === 'right') state.hinge = raw.hinge;
  if (raw.slabType === 'bottom' || raw.slabType === 'top' || raw.slabType === 'double') {
    state.slabType = raw.slabType;
  }
  if (raw.stairHalf === 'bottom' || raw.stairHalf === 'top') state.stairHalf = raw.stairHalf;
  if (Number.isInteger(raw.fluidLevel) && finite(raw.fluidLevel)) {
    state.fluidLevel = clampNumber(Math.floor(raw.fluidLevel), 1, 8);
  }
  if (typeof raw.fluidFalling === 'boolean') state.fluidFalling = raw.fluidFalling;
  if (typeof raw.railShape === 'string' && NETWORK_RAIL_SHAPES.has(raw.railShape)) {
    state.railShape = raw.railShape as NetworkRailShape;
  }
  return Object.keys(state).length > 0 ? state : undefined;
}

function parseBlockChange(entry: unknown): BlockChange | undefined {
  if (!isRecord(entry)) return undefined;
  if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y) || !Number.isInteger(entry.z) || !Number.isInteger(entry.blockId)) {
    return undefined;
  }
  if (!finite(entry.x) || !finite(entry.y) || !finite(entry.z) || !finite(entry.blockId)) return undefined;
  const state = parseNetworkBlockState(entry.state);
  return {
    x: entry.x,
    y: entry.y,
    z: entry.z,
    blockId: entry.blockId,
    ...(state ? { state } : {}),
  };
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
      if (raw.mining !== undefined && !bool(raw.mining)) return { error: 'input.mining invalid' };
      if (raw.use !== undefined && !bool(raw.use)) return { error: 'input.use invalid' };
      const vehicleForward = raw.vehicleForward === undefined
        ? undefined
        : finite(raw.vehicleForward) ? clampNumber(raw.vehicleForward, -1, 1) : undefined;
      if (raw.vehicleForward !== undefined && vehicleForward === undefined) {
        return { error: 'input.vehicleForward invalid' };
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
        ...(raw.mining === true ? { mining: true } : {}),
        ...(raw.use === true ? { use: true } : {}),
        ...(vehicleForward !== undefined ? { vehicleForward } : {}),
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
    case 'inventory_action': {
      if (typeof raw.action !== 'string' || !(INVENTORY_ACTIONS as readonly string[]).includes(raw.action)) {
        return { error: 'inventory_action.action invalid' };
      }
      if (raw.button !== undefined && raw.button !== 'left' && raw.button !== 'right') {
        return { error: 'inventory_action.button invalid' };
      }
      if (raw.shift !== undefined && !bool(raw.shift)) return { error: 'inventory_action.shift invalid' };
      if (raw.kind !== undefined && !(CONTAINER_KINDS as readonly string[]).includes(raw.kind as string)) {
        return { error: 'inventory_action.kind invalid' };
      }
      const slot = optionalInteger(raw.slot);
      if (raw.slot !== undefined && slot === undefined) return { error: 'inventory_action.slot invalid' };
      const count = optionalInteger(raw.count);
      if (raw.count !== undefined && (count === undefined || count < 1 || count > 64)) {
        return { error: 'inventory_action.count invalid' };
      }
      const x = optionalInteger(raw.x);
      const y = optionalInteger(raw.y);
      const z = optionalInteger(raw.z);
      if ((raw.x !== undefined && x === undefined)
        || (raw.y !== undefined && y === undefined)
        || (raw.z !== undefined && z === undefined)) {
        return { error: 'inventory_action coordinates invalid' };
      }
      const key = optionalString(raw.key, 64);
      const recipeId = optionalString(raw.recipeId, 64);
      return {
        type: 'inventory_action',
        action: raw.action as InventoryActionKind,
        ...(key ? { key } : {}),
        ...(raw.button ? { button: raw.button } : {}),
        ...(raw.shift === true ? { shift: true } : {}),
        ...(slot !== undefined ? { slot } : {}),
        ...(count !== undefined ? { count } : {}),
        ...(raw.kind ? { kind: raw.kind as ContainerKind } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(z !== undefined ? { z } : {}),
        ...(recipeId ? { recipeId } : {}),
      };
    }
    case 'craft': {
      if (raw.shift !== undefined && !bool(raw.shift)) return { error: 'craft.shift invalid' };
      return { type: 'craft', ...(raw.shift === true ? { shift: true } : {}) };
    }
    case 'interact':
      return { type: 'interact' };
    case 'attack':
      return { type: 'attack' };
    case 'pickup': {
      const entityId = optionalString(raw.entityId, 64);
      return { type: 'pickup', ...(entityId ? { entityId } : {}) };
    }
    case 'vehicle_input': {
      if (typeof raw.action !== 'string' || !(VEHICLE_ACTIONS as readonly string[]).includes(raw.action)) {
        return { error: 'vehicle_input.action invalid' };
      }
      const entityId = optionalString(raw.entityId, 64);
      const forward = raw.forward === undefined
        ? undefined
        : finite(raw.forward) ? clampNumber(raw.forward, -1, 1) : undefined;
      if (raw.forward !== undefined && forward === undefined) {
        return { error: 'vehicle_input.forward invalid' };
      }
      return {
        type: 'vehicle_input',
        action: raw.action as VehicleAction,
        ...(entityId ? { entityId } : {}),
        ...(forward !== undefined ? { forward } : {}),
      };
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
      const change = parseBlockChange(raw);
      if (!change) return { error: 'block_update invalid' };
      return {
        type: 'block_update',
        x: change.x,
        y: change.y,
        z: change.z,
        blockId: change.blockId,
        ...(change.state ? { state: change.state } : {}),
      };
    }
    case 'block_batch': {
      if (!Array.isArray(raw.changes)) return { error: 'block_batch invalid' };
      const changes: BlockChange[] = [];
      for (const entry of raw.changes.slice(0, 512)) {
        const change = parseBlockChange(entry);
        if (change) changes.push(change);
      }
      return { type: 'block_batch', changes };
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
    case 'entity_snapshot': {
      if (!finite(raw.tick) || !Number.isInteger(raw.tick) || raw.tick < 0 || !Array.isArray(raw.entities)) {
        return { error: 'entity_snapshot invalid' };
      }
      return raw as unknown as ServerEntitySnapshotMessage;
    }
    case 'entity_event': {
      if (!finite(raw.tick) || !Number.isInteger(raw.tick) || raw.tick < 0 || !Array.isArray(raw.events)) {
        return { error: 'entity_event invalid' };
      }
      const events: NetworkEntityEvent[] = [];
      for (const entry of raw.events) {
        if (!isRecord(entry) || typeof entry.entityId !== 'string' || entry.entityId.length === 0) continue;
        if (entry.kind !== 'hurt' && entry.kind !== 'death'
          && entry.kind !== 'projectile_spawn' && entry.kind !== 'projectile_hit') {
          continue;
        }
        events.push({ entityId: entry.entityId, kind: entry.kind });
      }
      return { type: 'entity_event', tick: raw.tick, events };
    }
    case 'health': {
      if (!finite(raw.health) || !finite(raw.hunger) || !bool(raw.dead) || !bool(raw.fire)) {
        return { error: 'health invalid' };
      }
      return raw as unknown as ServerHealthMessage;
    }
    case 'effects': {
      if (!Array.isArray(raw.effects)) return { error: 'effects invalid' };
      return raw as unknown as ServerEffectsMessage;
    }
    case 'command_result': {
      if (!bool(raw.ok) || typeof raw.name !== 'string' || !Array.isArray(raw.lines)) {
        return { error: 'command_result invalid' };
      }
      return raw as unknown as ServerCommandResultMessage;
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
