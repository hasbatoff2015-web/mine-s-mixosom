/**
 * Node-safe ambients for shared simulation / server typecheck.
 * Not a DOM library: no window, document, HTMLElement, IndexedDB, or WebGL.
 * Runtime: Node 18+ (performance, structuredClone, fetch, Web Streams).
 */

interface Performance {
  now(): number;
}

declare const performance: Performance;

declare function structuredClone<T>(value: T): T;

type BufferSource = ArrayBufferView | ArrayBuffer;

type BlobPart = ArrayBuffer | ArrayBufferView | Blob | string;

interface Blob {
  stream(): ReadableStream<Uint8Array>;
}

declare const Blob: {
  prototype: Blob;
  new (blobParts?: BlobPart[], options?: { type?: string }): Blob;
};

interface ReadableStream<R = Uint8Array> {
  pipeThrough(transform: unknown): ReadableStream<R>;
}

interface Response {
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare const Response: {
  prototype: Response;
  new (body?: unknown): Response;
};

declare function fetch(input: string | URL, init?: unknown): Promise<Response>;

declare const DecompressionStream: {
  new (format: string): { readable: ReadableStream; writable: unknown };
};

declare const CompressionStream: {
  new (format: string): { readable: ReadableStream; writable: unknown };
};

declare const TextDecoder: {
  new (label?: string): { decode(input?: BufferSource): string };
};

declare const TextEncoder: {
  new (): { encode(input?: string): Uint8Array };
};
