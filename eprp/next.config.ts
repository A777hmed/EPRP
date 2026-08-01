import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next dev` and `next build` both write to `.next` by default, so running a
   * verification build while the dev server is up replaces the routes it is
   * serving. Every dynamic route then returns 404 until the server restarts —
   * which is what made the project setup steps look like missing routes.
   *
   * Both commands still default to `.next`; set NEXT_DIST_DIR to build into a
   * scratch directory instead, e.g. `NEXT_DIST_DIR=.next-verify next build`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

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
