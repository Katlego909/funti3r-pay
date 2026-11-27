/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MARKETING_ONLY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_STELLAR_NETWORK?: string;
  readonly VITE_ADMIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
