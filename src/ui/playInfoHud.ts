/** Block coordinate. Negative values floor toward -infinity, same as voxel cells. */
export function floorCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value);
}

export function formatPlayInfo(online: number, x: number, y: number, z: number): string {
  const count = Number.isFinite(online) ? Math.max(0, Math.floor(online)) : 0;
  return `Игроков: ${count}\nX: ${floorCoord(x)}\nY: ${floorCoord(y)}\nZ: ${floorCoord(z)}`;
}
