/// <reference types="vite/client" />

// Custom env vars — see app/.env.example. All optional.
// The secret ones (VITE_GH_PAT, VITE_ANTHROPIC_API_KEY) are DEV-ONLY: they are read only
// under `import.meta.env.DEV`, and vite.config refuses to `build` if they are set, so a
// production bundle can never contain them (golden rule #7).
interface ImportMetaEnv {
  readonly VITE_BASE?: string;
  readonly VITE_USE_POLLING?: string;
  /** DEV-ONLY: fine-grained PAT for local auto-connect. Never set this for a build. */
  readonly VITE_GH_PAT?: string;
  /** DEV-ONLY: owner/repo to auto-connect for local testing (e.g. bamr87/lifehacker.dev). */
  readonly VITE_GH_REPO?: string;
  /** DEV-ONLY: pre-fills the power-hookup key field. Never set this for a build. */
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
