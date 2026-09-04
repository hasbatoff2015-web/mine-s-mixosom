/** Default local Anarchy server bind. Vite client uses 4173; do not collide. */
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 2567;
export const DEFAULT_TICK_RATE = 20;
export const DEFAULT_CHUNK_VIEW_RADIUS = 4;
export const DEFAULT_MAX_PLAYERS = 300;
export const DEFAULT_SERVER_NAME = 'Frontier Cubes Anarchy';
export const DEFAULT_WORLD_ID = 'anarchy';
export const PROTOCOL_VERSION = 2;

/** Max JSON text payload accepted from a client. */
export const MAX_CLIENT_MESSAGE_BYTES = 16_384;
export const MAX_CHAT_LENGTH = 256;
export const MAX_PLAYER_NAME_LENGTH = 16;
export const SESSION_RESUME_MS = 5 * 60_000;

export function defaultWsUrl(host = DEFAULT_SERVER_HOST, port = DEFAULT_SERVER_PORT): string {
  return `ws://${host}:${port}`;
}

export function defaultStatusUrl(host = DEFAULT_SERVER_HOST, port = DEFAULT_SERVER_PORT): string {
  return `http://${host}:${port}/status`;
}
