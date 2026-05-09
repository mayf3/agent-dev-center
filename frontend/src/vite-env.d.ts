/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IS_PUBLIC: string;
  readonly VITE_IS_PUBLIC_MODE: string;
  readonly VITE_ENABLE_REGISTRATION: string;
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
