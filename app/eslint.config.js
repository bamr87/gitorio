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
  {
    // The React adapter for <fleet-assist> is seeded by the hub's assistant kit (bamr87/bamr87
    // templates/assistant) and kept as the kit wrote it. Its `declare module 'react' { namespace
    // JSX … }` is the one augmentation that compiles on React 18 and 19, so declaration
    // namespaces are allowed in that file only; every other rule still applies to it. Matched by
    // name, the way the fan-out finds it.
    files: ['src/**/AssistBridge.tsx'],
    rules: {
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
]);
