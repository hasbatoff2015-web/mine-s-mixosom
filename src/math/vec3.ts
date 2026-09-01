/**
 * Simulation-neutral 3-vector. Duck-compatible with `{x,y,z}` and with the
 * subset of THREE.Vector3 that gameplay actually calls (set/copy/clone/add/…).
 * Shared simulation must not import `three` for vector types.
 */

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export class Vec3 implements MutableVec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setX(x: number): this {
    this.x = x;
    return this;
  }

  setY(y: number): this {
    this.y = y;
    return this;
  }

  setZ(z: number): this {
    this.z = z;
    return this;
  }

  copy(v: Vec3Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScaledVector(v: Vec3Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vec3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  subVectors(a: Vec3Like, b: Vec3Like): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const len = this.length();
    if (len > 1e-12) this.multiplyScalar(1 / len);
    return this;
  }

  distanceToSquared(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceTo(v: Vec3Like): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  lerp(v: Vec3Like, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  fromArray(values: readonly number[]): this {
    this.x = values[0] ?? 0;
    this.y = values[1] ?? 0;
    this.z = values[2] ?? 0;
    return this;
  }

  equals(v: Vec3Like): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
}

export function isVec3Like(value: unknown): value is Vec3Like {
  return !!value
    && typeof value === 'object'
    && Number.isFinite((value as Vec3Like).x)
    && Number.isFinite((value as Vec3Like).y)
    && Number.isFinite((value as Vec3Like).z);
}
