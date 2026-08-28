import {
  TAG_BYTE_ARRAY,
  TAG_COMPOUND,
  TAG_INT,
  TAG_LIST,
  asByteArray,
  asCompound,
  asList,
  asNumber,
  asString,
  parseNbt,
  writeNamedCompound,
  type NbtCompound,
  type NbtValue,
} from './nbt';
import { deflateGzip, inflateGzip, isGzip } from './inflate';

export interface SchematicBlockEntity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SchematicEntity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ParsedSchematic {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly offset: readonly [number, number, number];
  readonly palette: readonly string[];
  readonly blocks: Uint16Array;
  readonly blockEntities: readonly SchematicBlockEntity[];
  readonly entities: readonly SchematicEntity[];
}

function readVarInt(data: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    if (cursor >= data.length) throw new Error('Truncated schematic BlockData varint');
    const byte = data[cursor]!;
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error('Schematic varint too long');
  }
  return { value, next: cursor };
}

function writeVarInt(value: number, into: number[]): void {
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    into.push(byte);
  } while (remaining !== 0);
}

function paletteFromCompound(palette: NbtCompound | undefined): string[] {
  if (!palette) throw new Error('Schematic is missing a block palette');
  let max = -1;
  const entries: Array<{ name: string; index: number }> = [];
  for (const [name, raw] of Object.entries(palette)) {
    const index = asNumber(raw, -1);
    if (index < 0) continue;
    entries.push({ name, index });
    if (index > max) max = index;
  }
  const names = Array.from({ length: max + 1 }, () => 'minecraft:air');
  for (const entry of entries) names[entry.index] = entry.name;
  return names;
}

function blockEntitiesFrom(list: NbtValue[]): SchematicBlockEntity[] {
  const result: SchematicBlockEntity[] = [];
  for (const entry of list) {
    const compound = asCompound(entry);
    if (!compound) continue;
    const id = asString(compound.Id) ?? asString(compound.id) ?? 'unknown';
    const pos = compound.Pos;
    let x = asNumber(compound.x, 0);
    let y = asNumber(compound.y, 0);
    let z = asNumber(compound.z, 0);
    if (pos instanceof Int32Array && pos.length >= 3) {
      x = pos[0]!;
      y = pos[1]!;
      z = pos[2]!;
    } else if (Array.isArray((pos as { value?: NbtValue[] } | undefined)?.value)) {
      const values = (pos as { value: NbtValue[] }).value;
      x = asNumber(values[0], x);
      y = asNumber(values[1], y);
      z = asNumber(values[2], z);
    }
    result.push({ id, x, y, z });
  }
  return result;
}

function entitiesFrom(list: NbtValue[]): SchematicEntity[] {
  const result: SchematicEntity[] = [];
  for (const entry of list) {
    const compound = asCompound(entry);
    if (!compound) continue;
    const id = asString(compound.Id) ?? asString(compound.id) ?? 'unknown';
    const pos = compound.Pos as { value?: NbtValue[] } | undefined;
    const values = pos?.value ?? [];
    result.push({
      id,
      x: asNumber(values[0], 0),
      y: asNumber(values[1], 0),
      z: asNumber(values[2], 0),
    });
  }
  return result;
}

function decodeBlockData(data: Uint8Array, count: number, paletteSize: number): Uint16Array {
  const blocks = new Uint16Array(count);
  let offset = 0;
  for (let i = 0; i < count; i += 1) {
    const read = readVarInt(data, offset);
    if (read.value >= paletteSize) throw new Error(`Palette index ${read.value} is out of range`);
    blocks[i] = read.value;
    offset = read.next;
  }
  return blocks;
}

function spongeRoot(parsed: NbtCompound): NbtCompound {
  const schematic = asCompound(parsed.Schematic);
  if (schematic) return schematic;
  if (parsed.Width !== undefined || parsed.Blocks !== undefined || parsed.Palette !== undefined) return parsed;
  const first = Object.values(parsed)[0];
  const nested = asCompound(first);
  if (nested && (nested.Width !== undefined || nested.Blocks !== undefined)) return nested;
  throw new Error('Not a Sponge schematic');
}

export function schematicIndex(x: number, y: number, z: number, width: number, length: number): number {
  return (y * length + z) * width + x;
}

export function parseSchematicNbt(bytes: Uint8Array): ParsedSchematic {
  const parsed = parseNbt(bytes);
  const root = spongeRoot(parsed);
  const version = asNumber(root.Version, 2);
  const blocksCompound = asCompound(root.Blocks);
  const width = asNumber(root.Width ?? blocksCompound?.Width, 0);
  const height = asNumber(root.Height ?? blocksCompound?.Height, 0);
  const length = asNumber(root.Length ?? blocksCompound?.Length, 0);
  if (width <= 0 || height <= 0 || length <= 0) {
    throw new Error(`Invalid schematic dimensions ${width}×${height}×${length}`);
  }
  const offsetTag = root.Offset;
  let offset: [number, number, number] = [0, 0, 0];
  if (offsetTag instanceof Int32Array && offsetTag.length >= 3) {
    offset = [offsetTag[0]!, offsetTag[1]!, offsetTag[2]!];
  } else if (Array.isArray((offsetTag as { value?: NbtValue[] } | undefined)?.value)) {
    const values = (offsetTag as { value: NbtValue[] }).value;
    offset = [asNumber(values[0]), asNumber(values[1]), asNumber(values[2])];
  }

  const paletteCompound = asCompound(blocksCompound?.Palette) ?? asCompound(root.Palette);
  const palette = paletteFromCompound(paletteCompound);
  const data = asByteArray(blocksCompound?.Data) ?? asByteArray(root.BlockData);
  if (!data) throw new Error('Schematic is missing BlockData');
  const count = width * height * length;
  const blocks = decodeBlockData(data, count, palette.length);
  const blockEntities = blockEntitiesFrom(asList(blocksCompound?.BlockEntities ?? root.BlockEntities));
  const entities = entitiesFrom(asList(root.Entities));
  return { version, width, height, length, offset, palette, blocks, blockEntities, entities };
}

export async function parseSchematic(bytes: Uint8Array): Promise<ParsedSchematic> {
  const nbt = isGzip(bytes) ? await inflateGzip(bytes) : bytes;
  return parseSchematicNbt(nbt);
}

export function encodeSpongeSchematicV2(input: {
  width: number;
  height: number;
  length: number;
  palette: readonly string[];
  blocks: Uint16Array;
  blockEntities?: readonly SchematicBlockEntity[];
  entities?: readonly SchematicEntity[];
  offset?: readonly [number, number, number];
}): Uint8Array {
  const palette: NbtCompound = {};
  for (let i = 0; i < input.palette.length; i += 1) palette[input.palette[i]!] = i;
  const varintBytes: number[] = [];
  for (let i = 0; i < input.blocks.length; i += 1) writeVarInt(input.blocks[i]!, varintBytes);
  const blockEntities = {
    type: TAG_COMPOUND,
    value: (input.blockEntities ?? []).map((entity) => ({
      Id: entity.id,
      x: entity.x,
      y: entity.y,
      z: entity.z,
    })),
  };
  const entities = {
    type: TAG_COMPOUND,
    value: (input.entities ?? []).map((entity) => ({
      Id: entity.id,
      Pos: { type: TAG_INT, value: [entity.x, entity.y, entity.z] },
    })),
  };
  const root: NbtCompound = {
    Version: 2,
    Width: input.width,
    Height: input.height,
    Length: input.length,
    PaletteMax: input.palette.length,
    Palette: palette,
    BlockData: new Int8Array(varintBytes),
    BlockEntities: blockEntities,
    Entities: entities,
  };
  return writeNamedCompound('Schematic', root);
}

export async function encodeSpongeSchematicGzip(input: Parameters<typeof encodeSpongeSchematicV2>[0]): Promise<Uint8Array> {
  return deflateGzip(encodeSpongeSchematicV2(input));
}

export { TAG_BYTE_ARRAY, TAG_LIST };
