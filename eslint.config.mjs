import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored/generated trees — linting the 5.8MB Cesium build drowns real
    // errors in ~31k vendor findings and breaks CI.
    "public/cesium/**",
    ".pnpm-store/**",
    // Standalone Node data-gen scripts (run with `node`, CommonJS) — not part of
    // the app bundle, so the app's ESM/TS rules don't apply.
    "scripts/**",
  ]),
]);

export default eslintConfig;
