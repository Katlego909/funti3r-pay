/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MARKETING_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
