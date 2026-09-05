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

  experimental: {
    /*
     * Turbopack's persistent filesystem cache, OFF for the dev server.
     *
     * Next 16 turns this on by default and documents it as beta
     * (node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md:
     * "turbopackFileSystemCacheForDev ... Default (dev): true"). On this
     * project it is the source of the long "Compiling..." stalls, and
     * deleting the directory is only a temporary reprieve:
     *
     *   - the store grew to 2.1 GB, was deleted, and regrew to 1.8 GB in a
     *     single fresh session;
     *   - that session logged three "Finished filesystem cache database
     *     compaction" pauses of 10.6s, 15.3s and 12.2s inside one minute,
     *     one of them while a route was compiling;
     *   - the earlier session logged a 2.5min cache write and an 82s compile.
     *
     * Compaction cost scales with the store, so the stalls return as soon as
     * it refills — this is recurring, not one-time cold compilation.
     *
     * THE TRADE-OFF: without the persistent cache, nothing is carried across
     * dev-server RESTARTS, so the first compile after each `npm run dev` is
     * cold. Within a session compilation is unaffected — Turbopack still
     * caches in memory — which is exactly where the stalls were being felt.
     * Restarts are occasional; navigation is constant.
     *
     * Dev only. `next build` is untouched: `turbopackFileSystemCacheForBuild`
     * is opt-in and already off, so production builds keep their behaviour.
     * Remove this line to return to the Next default once the feature leaves
     * beta.
     */
    turbopackFileSystemCacheForDev: false,
  },

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
