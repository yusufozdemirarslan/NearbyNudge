/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" when running `npm run dev:mock`; "0" otherwise (replaced at build time). */
  readonly VITE_MOCK_API: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
