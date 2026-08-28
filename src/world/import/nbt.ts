/** Minimal big-endian NBT reader/writer for Sponge schematics. */

export interface NbtList {
  type: number;
  value: NbtValue[];
}
export interface NbtCompound {
  [key: string]: NbtValue;
}
export type NbtValue =
  | number
  | bigint
  | string
  | Int8Array
  | Int32Array
  | BigInt64Array
  | NbtList
  | NbtCompound;

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

class NbtReader {
  offset = 0;
  constructor(private readonly view: DataView) {}

  remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  i8(): number {
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.offset);
    this.offset += 2;
    return value;
  }

  i32(): number {
    const value = this.view.getInt32(this.offset);
    this.offset += 4;
    return value;
  }

  i64(): bigint {
    const value = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return value;
  }

  f32(): number {
    const value = this.view.getFloat32(this.offset);
    this.offset += 4;
    return value;
  }

  f64(): number {
    const value = this.view.getFloat64(this.offset);
    this.offset += 8;
    return value;
  }

  string(): string {
    const length = this.view.getUint16(this.offset);
    this.offset += 2;
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  payload(type: number): NbtValue {
    switch (type) {
      case TAG_BYTE: return this.i8();
      case TAG_SHORT: return this.i16();
      case TAG_INT: return this.i32();
      case TAG_LONG: return this.i64();
      case TAG_FLOAT: return this.f32();
      case TAG_DOUBLE: return this.f64();
      case TAG_BYTE_ARRAY: {
        const length = this.i32();
        const bytes = new Int8Array(length);
        for (let i = 0; i < length; i += 1) bytes[i] = this.i8();
        return bytes;
      }
      case TAG_STRING: return this.string();
      case TAG_LIST: {
        const itemType = this.u8();
        const length = this.i32();
        const value: NbtValue[] = [];
        for (let i = 0; i < length; i += 1) value.push(itemType === TAG_END ? {} : this.payload(itemType));
        return { type: itemType, value };
      }
      case TAG_COMPOUND: return this.compound();
      case TAG_INT_ARRAY: {
        const length = this.i32();
        const values = new Int32Array(length);
        for (let i = 0; i < length; i += 1) values[i] = this.i32();
        return values;
      }
      case TAG_LONG_ARRAY: {
        const length = this.i32();
        const values = new BigInt64Array(length);
        for (let i = 0; i < length; i += 1) values[i] = this.i64();
        return values;
      }
      default:
        throw new Error(`Unsupported NBT tag ${type}`);
    }
  }

  compound(): NbtCompound {
    const result: NbtCompound = {};
    for (;;) {
      const type = this.u8();
      if (type === TAG_END) break;
      const name = this.string();
      result[name] = this.payload(type);
    }
    return result;
  }

  named(): { name: string; value: NbtCompound } {
    const type = this.u8();
    if (type !== TAG_COMPOUND) throw new Error(`Expected NBT compound root, got ${type}`);
    const name = this.string();
    return { name, value: this.compound() };
  }
}

class NbtWriter {
  private readonly chunks: Uint8Array[] = [];

  u8(value: number): void {
    this.chunks.push(Uint8Array.of(value & 0xff));
  }

  i8(value: number): void {
    this.u8(value);
  }

  i16(value: number): void {
    const buffer = new Uint8Array(2);
    new DataView(buffer.buffer).setInt16(0, value);
    this.chunks.push(buffer);
  }

  u16(value: number): void {
    const buffer = new Uint8Array(2);
    new DataView(buffer.buffer).setUint16(0, value);
    this.chunks.push(buffer);
  }

  i32(value: number): void {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setInt32(0, value);
    this.chunks.push(buffer);
  }

  string(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.u16(bytes.length);
    this.chunks.push(bytes);
  }

  payload(type: number, value: NbtValue): void {
    switch (type) {
      case TAG_BYTE: this.i8(Number(value)); return;
      case TAG_SHORT: this.i16(Number(value)); return;
      case TAG_INT: this.i32(Number(value)); return;
      case TAG_STRING: this.string(String(value)); return;
      case TAG_BYTE_ARRAY: {
        const bytes = value instanceof Int8Array ? value : new Int8Array(value as Iterable<number>);
        this.i32(bytes.length);
        this.chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        return;
      }
      case TAG_LIST: {
        const list = value as NbtList;
        this.u8(list.type);
        this.i32(list.value.length);
        for (const item of list.value) this.payload(list.type, item);
        return;
      }
      case TAG_COMPOUND:
        this.compound(value as NbtCompound);
        return;
      default:
        throw new Error(`NBT writer does not support tag ${type}`);
    }
  }

  compound(value: NbtCompound): void {
    for (const [name, entry] of Object.entries(value)) {
      const type = inferTag(entry);
      this.u8(type);
      this.string(name);
      this.payload(type, entry);
    }
    this.u8(TAG_END);
  }

  named(name: string, value: NbtCompound): Uint8Array {
    this.u8(TAG_COMPOUND);
    this.string(name);
    this.compound(value);
    let length = 0;
    for (const chunk of this.chunks) length += chunk.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function inferTag(value: NbtValue): number {
  if (typeof value === 'number') return TAG_INT;
  if (typeof value === 'string') return TAG_STRING;
  if (value instanceof Int8Array) return TAG_BYTE_ARRAY;
  if (Array.isArray((value as NbtList).value) && typeof (value as NbtList).type === 'number') return TAG_LIST;
  return TAG_COMPOUND;
}

export function parseNbt(bytes: Uint8Array): NbtCompound {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reader = new NbtReader(view);
  const root = reader.named();
  if (root.name) return { [root.name]: root.value };
  return root.value;
}

export function writeNamedCompound(name: string, value: NbtCompound): Uint8Array {
  return new NbtWriter().named(name, value);
}

export function asCompound(value: NbtValue | undefined): NbtCompound | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Int8Array) return undefined;
  if ('type' in value && 'value' in value && Array.isArray((value as NbtList).value)) return undefined;
  return value as NbtCompound;
}

export function asNumber(value: NbtValue | undefined, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

export function asString(value: NbtValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asByteArray(value: NbtValue | undefined): Uint8Array | undefined {
  if (value instanceof Int8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

export function asList(value: NbtValue | undefined): NbtValue[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray((value as NbtList).value)) return (value as NbtList).value;
  return [];
}

export function tagCompound(): number { return TAG_COMPOUND; }
export function tagByteArray(): number { return TAG_BYTE_ARRAY; }
export function tagInt(): number { return TAG_INT; }
export function tagShort(): number { return TAG_SHORT; }
export function tagString(): number { return TAG_STRING; }
export function tagList(): number { return TAG_LIST; }
export { TAG_COMPOUND, TAG_BYTE_ARRAY, TAG_INT, TAG_SHORT, TAG_STRING, TAG_LIST };
