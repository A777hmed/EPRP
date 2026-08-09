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
    // Verification builds write to a scratch dist directory so they do not
    // replace the routes `next dev` is serving — see `distDir` in
    // next.config.ts. It is gitignored (`/.next-*/`) and must be ignored here
    // too, otherwise a bare `eslint` run lints the build output.
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
