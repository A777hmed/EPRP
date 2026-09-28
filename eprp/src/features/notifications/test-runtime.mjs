// Test-only Node resolution for the application's existing @/ and extensionless
// TypeScript imports. Production uses Next.js; this does not mock application code.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const sourceRoot = new URL("../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.conditions.includes("require")) return nextResolve(specifier, context);
    // Match the ESM entry selected by Next.js for this dual-format package.
    if (specifier === "@supabase/ssr") return nextResolve(new URL("../node_modules/@supabase/ssr/dist/module/index.js", sourceRoot).href, context);
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return nextResolve(specifier, context);
    const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), sourceRoot) : new URL(specifier, context.parentURL);
    const candidates = [base.href, `${base.href}.ts`, `${base.href}.tsx`, `${base.href}.js`, `${base.href}/index.ts`, `${base.href}/index.js`];
    for (const candidate of candidates) {
      if (/\.(ts|tsx|js|mjs)$/.test(candidate) && existsSync(fileURLToPath(candidate))) return nextResolve(candidate, context);
    }
    return nextResolve(specifier, context);
  },
});
