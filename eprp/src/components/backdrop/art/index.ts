import { PlanningScheduleArt } from "./planning-schedule";
import { PortfolioReviewArt } from "./portfolio-review";
import { RefineryPlanningArt } from "./refinery-planning";
import { ReportingCollaborationArt } from "./reporting-collaboration";

export { ART_HEIGHT, ART_WIDTH } from "./primitives";

/**
 * The backdrop family. Four compositions on one construction system:
 *
 * - `refinery`      project planning in front of the plant — the main backdrop
 * - `planning`      schedule, milestones and dependencies (Milestones / Tasks)
 * - `collaboration` coordination, reporting and reporting lines
 * - `review`        portfolio and management review — the Reporting family's
 *                   quieter scene, for Executive reporting
 */
export const BACKDROP_ART = {
  refinery: RefineryPlanningArt,
  planning: PlanningScheduleArt,
  collaboration: ReportingCollaborationArt,
  review: PortfolioReviewArt,
} as const;

export type BackdropVariant = keyof typeof BACKDROP_ART;
