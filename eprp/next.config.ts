import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
