export const siteConfig = {
  /** Platform abbreviation, used in breadcrumbs and compact branding. */
  name: "EPR",
  fullName: "EPROM Progress Report",
  company: "EPROM — Egyptian Projects Operation & Maintenance",
  description:
    "Internal EPROM platform for tracking project progress, milestones, and executive reporting.",
  logo: {
    /** Full horizontal lockup (drops + wordmark), light backgrounds only. */
    full: "/brand/eprom-logo.png",
    fullWidth: 445,
    fullHeight: 120,
    /** Square drop mark for compact/collapsed contexts. */
    mark: "/brand/eprom-mark.png",
    markWidth: 124,
    markHeight: 120,
  },
} as const;

export type SiteConfig = typeof siteConfig;
