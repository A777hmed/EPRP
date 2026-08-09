import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Dev and build write to **separate** directories.
   *
   * They previously shared `.next`, so any `next build` — including the plain
   * `npm run build` — overwrote the output `next dev` was serving. The dev
   * server was then left reading a directory holding production manifests
   * (BUILD_ID, prerender-manifest, required-server-files) beside its own dev
   * output, and every dynamic route 404'd. That is the recurring "Project
   * Setup 404": not a missing route, a poisoned dist directory.
   *
   * Relying on the operator to remember NEXT_DIST_DIR on every build is not a
   * fix, because the standard command is the one that breaks it. Separating
   * the defaults makes the collision impossible.
   *
   *   next dev   -> NODE_ENV=development -> .next-dev
   *   next build -> NODE_ENV=production  -> .next
   *
   * .gitignore already excludes /.next-*\/ so the dev directory is ignored.
   * NEXT_DIST_DIR still overrides both, for one-off isolated builds.
   *
   * Note: no backticks in this comment — the SWC config loader parses them as
   * a template literal and fails to load the file.
   */
  distDir:
    process.env.NEXT_DIST_DIR ??
    (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),

  async redirects() {
    // Phase 4C route restructure: report routes moved to top level.
    return [
      { source: "/reports/weekly", destination: "/weekly-reports", permanent: false },
      { source: "/reports/monthly", destination: "/monthly-reports", permanent: false },
      { source: "/reports/executive", destination: "/executive-reports", permanent: false },
    ];
  },
};

export default nextConfig;
