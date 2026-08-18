// Flat ESLint config (BL-20260816-11): typescript-eslint recommended (non-type-checked,
// for speed) + react-hooks recommended over src. Formatting is Prettier's job, not ESLint's.
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    rules: {
      // React-Compiler-era rule; the two existing sync setState-in-effect sites (App tab/
      // telemetry sync, DeployModal load state) are deliberate — fixing them means a
      // behavioural refactor, not a lint cleanup. Revisit if the compiler is adopted.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
