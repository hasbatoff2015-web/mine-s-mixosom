declare module 'three/addons/lines/LineSegments2.js' {
  import { Mesh, BufferGeometry, Material } from 'three';
  export class LineSegments2 extends Mesh {
    constructor(geometry?: BufferGeometry, material?: Material);
  }
}

declare module 'three/addons/lines/LineSegmentsGeometry.js' {
  import { InstancedBufferGeometry } from 'three';
  export class LineSegmentsGeometry extends InstancedBufferGeometry {
    setPositions(array: Float32Array | number[]): this;
  }
}

declare module 'three/addons/lines/LineMaterial.js' {
  import { Color, ShaderMaterial } from 'three';
  export class LineMaterial extends ShaderMaterial {
    constructor(parameters?: Record<string, unknown>);
    color: Color;
    linewidth: number;
    worldUnits: boolean;
  }
}
