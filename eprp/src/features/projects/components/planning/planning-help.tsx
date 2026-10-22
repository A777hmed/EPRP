"use client";

import * as React from "react";

import { ContextHelp } from "@/components/shared";

/**
 * Phase 13.11 — the Planning concepts that need explaining, written ONCE and
 * shown through the shared {@link ContextHelp} pattern. Every Planning
 * surface uses these entries, so an explanation is never duplicated or
 * allowed to drift between Guided, Advanced and the Master Plan.
 *
 * Wording only: nothing here changes a calculation, a rule or a stored value.
 */

export interface PlanningHelpEntry {
  topic: string;
  body: React.ReactNode;
  example?: React.ReactNode;
  learnMore?: React.ReactNode;
}

export type PlanningHelpConcept =
  | "planningSetup"
  | "setupViews"
  | "planningLevels"
  | "controlAccount"
  | "weightSource"
  | "earningMethod"
  | "localWeight"
  | "contribution"
  | "childrenTotal"
  | "recordedWeight"
  | "dataDate"
  | "readiness"
  | "history";

export const PLANNING_HELP: Record<PlanningHelpConcept, PlanningHelpEntry> = {
  planningSetup: {
    topic: "Planning setup",
    body: (
      <>
        <p>
          Defines how this project&apos;s plan is structured and measured: its
          breakdown levels, where weights come from and how progress is earned.
        </p>
        <p>The actual nodes and activities are added in Master Plan, or imported.</p>
        <p>
          These settings decide how PV (Planned Value), EV (Earned Value) and SPI
          (Schedule Performance Index) are calculated. Those figures are always
          calculated by EPRP, never typed in.
        </p>
      </>
    ),
  },
  setupViews: {
    topic: "Guided and Advanced",
    body: (
      <>
        <p>Guided asks simple questions one at a time, then shows a summary before saving.</p>
        <p>Advanced shows the same settings together on one form.</p>
        <p>Both edit the same saved configuration, so switching loses nothing.</p>
      </>
    ),
  },
  planningLevels: {
    topic: "Planning levels",
    body: (
      <>
        <p>
          Levels organise the planning hierarchy from the top down. Weights and
          progress roll up through them.
        </p>
        <p>
          Activities are the actual work. They are not a level created here;
          they are added under a node in Master Plan.
        </p>
      </>
    ),
    example: "Control Account → Work Package → Activity (e.g. RBI → VDU → Data collection).",
  },
  controlAccount: {
    topic: "Control Account level",
    body: (
      <>
        <p>
          The main management level: where performance is rolled up, reviewed
          and explained to management.
        </p>
        <p>Any single node can also be flagged as a Control Account in Master Plan.</p>
      </>
    ),
    example: "RBI, HAZOP and SIL are each reported and explained as one Control Account.",
  },
  weightSource: {
    topic: "Weight source",
    body: (
      <>
        <p>
          A weight is an item&apos;s share of its parent. EPRP multiplies the shares
          down the hierarchy to calculate each item&apos;s contribution to the whole
          project.
        </p>
        <p>
          Choose whether shares are entered in EPRP or arrive with the imported
          schedule. Imported shares are proposals reviewed by Project Control;
          weights are never rescaled automatically.
        </p>
      </>
    ),
    example: "VDU = 40% of RBI, and RBI = 10% of the project, so VDU contributes 4% of the project.",
  },
  earningMethod: {
    topic: "Default earning method",
    body: (
      <>
        <p>
          How an activity earns progress unless the activity, or its part of the
          plan, uses a different method.
        </p>
        <ul className="grid gap-1 pl-4 [list-style:disc]">
          <li>Percent complete — earns its confirmed physical % complete.</li>
          <li>0/100 — earns nothing until finished, then all of it.</li>
          <li>50/50 — half when it starts, the rest when it finishes.</li>
          <li>Milestone — earns when the milestone is achieved; for true milestones only.</li>
        </ul>
      </>
    ),
    example: "A study task by percent complete; a site walkdown by 0/100.",
  },
  localWeight: {
    topic: "Local weight",
    body: (
      <>
        <p>
          This item&apos;s share of its parent, in percent. The parent&apos;s direct
          children — nodes and activities together — must total 100%.
        </p>
        <p>Leave it blank until decided: blank is never read as 0.</p>
      </>
    ),
    example: "VDU 40%, CDU 35% and Utilities 25% of RBI.",
  },
  contribution: {
    topic: "Project contribution",
    body: (
      <>
        <p>
          The item&apos;s share of the whole project, calculated by EPRP from the
          local weights on its path. It is never entered.
        </p>
        <p>It shows “—” until every weight above the item is set.</p>
      </>
    ),
    example: "RBI 10% × VDU 40% = 4% of the project.",
  },
  childrenTotal: {
    topic: "Children total",
    body: (
      <>
        <p>
          The local weights of a parent&apos;s direct children, added up. They must
          total 100% before a calculated snapshot can be published.
        </p>
        <p>
          If they do not, enter the missing weights, or record an explicit
          weight decision with a reason. Nothing is normalised automatically.
        </p>
      </>
    ),
  },
  recordedWeight: {
    topic: "Recorded weight",
    body: (
      <>
        <p>
          A weight entered or imported before local weights existed. Its meaning
          was never reviewed, so it is not used as a local weight.
        </p>
        <p>
          Project Control can accept it as the local weight with “Use recorded
          weights…”. That decision is logged with a reason.
        </p>
      </>
    ),
  },
  dataDate: {
    topic: "Data Date",
    body: (
      <p>
        The cut-off the snapshot reports as of: actual progress up to this date,
        forecasts after it. It is not the date the snapshot was published.
      </p>
    ),
  },
  readiness: {
    topic: "Planning readiness",
    body: (
      <p>
        The steps that bring this project under planning control. Each step&apos;s
        state is worked out from what already exists; nothing is ticked by hand.
      </p>
    ),
  },
  history: {
    topic: "History entries",
    body: (
      <ul className="grid gap-1 pl-4 [list-style:disc]">
        <li>Edited — a direct change by Project Control.</li>
        <li>Confirmed from import / Adjusted — an import review decision.</li>
        <li>Weights normalised — a weight decision for the parent&apos;s children, with a reason.</li>
        <li>Recorded weight adopted — a recorded weight accepted as the local weight.</li>
      </ul>
    ),
  },
};

/** The shared help popover for one Planning concept. */
export function PlanningHelp({
  concept,
  side,
  align,
}: {
  concept: PlanningHelpConcept;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const entry = PLANNING_HELP[concept];
  return (
    <ContextHelp topic={entry.topic} example={entry.example} learnMore={entry.learnMore} side={side} align={align}>
      {entry.body}
    </ContextHelp>
  );
}
