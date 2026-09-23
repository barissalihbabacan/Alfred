// ESLint flat config for B.U.T.L.E.R. Alfred.
//
// Goal: catch real bugs without forcing a mass reformat. Rules the codebase is
// already clean on are errors so they can't regress; the remaining noisy ones
// stay "warn". Formatting is intentionally not enforced here.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const unusedVarsOptions = {
  argsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
  caughtErrorsIgnorePattern: "^_",
  destructuredArrayIgnorePattern: "^_",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.claude/**",
      "**/.firebase/**",
      "**/coverage/**",
      "**/audio_output/**",
      ".agents/**",
      "apps/web/next-env.d.ts",
      // Build output: Next.js static export and the functions esbuild bundle.
      "**/out/**",
      "functions/lib/**",
    ],
  },

  js.configs.recommended,

  // --- TypeScript: core library, tests, scripts, Next.js app ---------------
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions],
      "@typescript-eslint/ban-ts-comment": "error",
      // Empty interfaces that extend a provider type are used as named aliases.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
    },
  },

  // --- Next.js app (apps/web, TS/TSX) ---------------------------------------
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Only the two classic hook rules; the React Compiler rules shipped in
      // eslint-plugin-react-hooks v7's "recommended" preset are not adopted.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // --- Plain JS: shared defaults --------------------------------------------
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    rules: {
      "no-unused-vars": ["error", unusedVarsOptions],
    },
  },

  // --- Firebase Cloud Functions (plain ESM on Node) -------------------------
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // --- Root / Next config files ---------------------------------------------
  {
    files: ["eslint.config.js", "apps/web/next.config.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // --- Repo-wide relaxations for existing code (tighten over time) ---------
  // Kept last so it overrides the presets above (incl. typescript-eslint).
  {
    rules: {
      // `catch {}` is used deliberately for best-effort parsing / cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "error",
      "prefer-const": "error",
    },
  },

  // --- Temporary carve-outs ------------------------------------------------
  // These files are being rewritten in a parallel PR (privacy filter / memory
  // candidate validation). Their remaining warnings are deliberately left
  // alone here to avoid conflicts; drop this block once that PR lands.
  {
    files: ["src/ai/prompts/memory-extraction.ts"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", unusedVarsOptions] },
  },
  {
    // In functions/index.js only the SENSITIVE_PATTERNS regexes still trip it.
    files: ["src/alfred/cognitive/memory/privacy-filter.ts", "functions/index.js"],
    rules: { "no-useless-escape": "warn" },
  },
);
