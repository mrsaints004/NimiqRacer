/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_NIM_RECIPIENT_ADDRESS?: string;
  readonly VITE_CAR_PRICE_LUNA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
