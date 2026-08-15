/**
 * Executive reporting — the live derived portfolio view.
 *
 * The barrel exports the three route entry points and nothing else, on purpose.
 *
 * A route file is a SERVER module, so everything this barrel re-exports is
 * evaluated in the server graph. `executive-model.ts` and `executive-data.ts`
 * carry no `"use client"` directive, and the chart model they sit beside builds
 * a module-scope lookup from a client-only export — re-exporting them here once
 * crashed every Executive route with "function is not iterable" before a single
 * component rendered.
 *
 * Client modules import what they need by path. `executive-access.ts` is
 * `server-only` and is likewise imported directly by the routes.
 */

export {
  ExecutiveDenied,
  ExecutivePortfolioView,
  ExecutivePreviewView,
  type ExecutiveViewerProps,
} from "./executive-view";
export { ExecutiveProjectDrilldown } from "./executive-drilldown";
export { ExecutiveRegisterView } from "./executive-register";
export { ExecutiveWorkspaceView } from "./executive-workspace";
