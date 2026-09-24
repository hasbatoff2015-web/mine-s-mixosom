/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANARCHY_URL?: string;
}

declare module 'virtual:player-skin-content-hashes' {
  const hashes: Readonly<Record<string, string>>;
  export default hashes;
}
