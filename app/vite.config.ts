import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// DEV-ONLY secrets that must NEVER end up in a client bundle (golden rule #7). Vite inlines
// every VITE_* var at build time, so we hard-fail the build if one of these is set.
const DEV_ONLY_SECRETS = ['VITE_GH_PAT', 'VITE_ANTHROPIC_API_KEY'];

export default defineConfig(({ command, mode }) => {
  // loadEnv merges .env files with matching process.env vars (e.g. CI's VITE_BASE).
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build') {
    const leaked = DEV_ONLY_SECRETS.filter((k) => env[k]);
    if (leaked.length > 0) {
      throw new Error(
        `Refusing to build: ${leaked.join(', ')} is set. These are DEV-ONLY local-testing ` +
          `secrets and would be baked into the client bundle. Unset them before building ` +
          `(they belong only in a local .env used with \`npm run dev\`).`,
      );
    }
  }

  return {
    // VITE_BASE is set by the Pages deploy workflow to "/<repo-name>/".
    base: env.VITE_BASE ?? '/',
    plugins: [react()],
    server: {
      host: true, // bind 0.0.0.0 so the dev server is reachable from a container / the LAN
      port: 5173,
      // VITE_USE_POLLING (Docker dev service) keeps HMR working across the macOS ↔ container fs.
      watch: env.VITE_USE_POLLING ? { usePolling: true } : undefined,
    },
  };
});
