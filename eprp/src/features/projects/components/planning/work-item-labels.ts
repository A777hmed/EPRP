import type { PlanningWorkItemType } from "@/types";

/**
 * Display names of the planning node classifications (describes the work; not
 * a level and never weighted — `docs/02` §26.3 H5). Shared by the node dialog
 * and the Master Plan table.
 */
export const WORK_ITEM_TYPE_LABEL: Record<PlanningWorkItemType, string> = {
  study: "Study",
  deliverable: "Deliverable",
  report: "Report",
  activity: "Activity",
  engineering: "Engineering",
  procurement: "Procurement",
  construction: "Construction",
  inspection: "Inspection",
  commissioning: "Commissioning",
  milestone: "Milestone",
  other: "Other",
};
