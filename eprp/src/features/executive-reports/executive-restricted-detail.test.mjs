import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregatePortfolio,
  detailVisibility,
  draftExecutiveNarrative,
  restrictedEmptyText,
  restrictedPartialNote,
} from "./executive-data.ts";
import { buildExecutivePanels } from "./executive-panels.ts";

/*
 * Restricted-detail presentation in the Executive Report.
 *
 * Operational detail — risks, decisions, actions, plan items, governed
 * milestones — is loaded only for projects the viewer holds detail access to
 * (`detailProjectIds` in `use-executive-portfolio.ts`). For the rest those
 * collections are empty because they were never read. These tests exercise the
 * REAL panel builders and narrative with that shape and prove:
 *
 *   · full access (Admin) output is unchanged, wording included;
 *   · "not visible" is never presented as "none" or as a zero;
 *   · a withheld project is only ever counted, never named;
 *   · permitted register aggregates (progress, health) are untouched.
 *
 * NOT covered, and not coverable without a live database: which projects the
 * data layer actually withholds. That is decided by RLS and the portfolio read
 * entitlements, which this change does not touch.
 */

const HIDDEN_NAME = "Hidden Refinery Revamp";
const HIDDEN_RISK = "Confidential vendor insolvency exposure";

function row({ id, name, detailAvailable = true, risks = [], milestoneStates = [], health = "on_track" }) {
  return {
    project: { id, code: id.toUpperCase(), name, shortName: name, status: "active" },
    projectName: name,
    detailAvailable,
    clientName: "Client",
    basis: "approved",
    planned: 60,
    actual: 55,
    variance: -5,
    planningBacked: false,
    reading: { health, label: health === "on_track" ? "On Track" : "Delayed", tone: "success", basis: "" },
    attention: risks,
    risks,
    decisions: [],
    clientActions: [],
    achievements: [],
    overdue: [],
    openActions: { total: 0 },
    milestones: [],
    milestoneStates,
    movement: [],
  };
}

function risk(projectId, projectName, text, priority = "high") {
  return {
    id: `${projectId}-risk`,
    projectId,
    projectName,
    kind: "risk",
    text,
    priority,
    priorityLabel: priority,
    priorityTone: "danger",
    statusLabel: "Open",
    statusTone: "danger",
    overdue: false,
  };
}

const MILESTONE = {
  milestone: { id: "m1", projectId: "p-visible", code: "M01", name: "Mechanical completion" },
  status: "in_progress",
  inConflict: false,
};

function panelsFor(rows) {
  const aggregate = aggregatePortfolio(rows);
  const panels = buildExecutivePanels({
    rows,
    aggregate,
    allMonthlies: [],
    visibleProjectIds: new Set(rows.map((entry) => entry.project.id)),
    month: "2026-09",
  });
  return { aggregate, byId: Object.fromEntries(panels.map((panel) => [panel.id, panel])) };
}

/* ------------------------------ Wording helpers ------------------------------ */

test("detailVisibility() counts withheld projects without reading their content", () => {
  assert.deepEqual(
    detailVisibility([{ detailAvailable: true }, { detailAvailable: false }, { detailAvailable: false }]),
    { visible: 1, restricted: 2 }
  );
  // Absent flag is not a restriction — only an explicit `false` is.
  assert.deepEqual(detailVisibility([{}]), { visible: 1, restricted: 0 });
});

test("restrictedEmptyText() returns the unrestricted wording unchanged when nothing is withheld", () => {
  const text = restrictedEmptyText({ visible: 3, restricted: 0 }, {
    fallback: "No open risks recorded across the portfolio.",
    subject: "Risk detail",
    noneVisible: "No open risks are recorded",
  });
  assert.equal(text, "No open risks recorded across the portfolio.");
});

test("restrictedEmptyText() never says 'none' for a fully withheld portfolio", () => {
  const text = restrictedEmptyText({ visible: 0, restricted: 4 }, {
    fallback: "No open risks recorded across the portfolio.",
    subject: "Risk detail",
    noneVisible: "No open risks are recorded",
  });
  assert.match(text, /restricted at your access level for all 4 projects/);
  assert.match(text, /no conclusion can be drawn/);
  assert.doesNotMatch(text, /^No open risks/);
});

test("restrictedEmptyText() scopes 'none' to the visible projects when access is partial", () => {
  const text = restrictedEmptyText({ visible: 2, restricted: 1 }, {
    fallback: "unused",
    subject: "Plan detail",
    noneVisible: "No dated plan items are recorded ahead of today",
  });
  assert.equal(
    text,
    "No dated plan items are recorded ahead of today for the 2 projects visible at your access level. " +
      "Plan detail is restricted for 1 project."
  );
});

test("restrictedPartialNote() is absent at full access", () => {
  assert.equal(restrictedPartialNote({ visible: 5, restricted: 0 }, "risk detail"), undefined);
  assert.match(restrictedPartialNote({ visible: 1, restricted: 3 }, "risk detail"), /restricted for 3 projects/);
});

/* ------------------------------- Chart panels -------------------------------- */

test("Admin (full access): risk, attention and milestone panels keep their existing output", () => {
  const { byId } = panelsFor([row({ id: "p-a", name: "Alpha" }), row({ id: "p-b", name: "Beta" })]);

  assert.equal(byId["risk-priority"].kind, "empty");
  assert.equal(byId["risk-priority"].text, "No open risks recorded across the portfolio.");

  const attention = byId.attention;
  assert.equal(attention.subtitle, "Open exceptions across the portfolio");
  assert.equal(attention.note, undefined);
  assert.ok(attention.items.every((item) => item.display === undefined && item.value === 0));

  assert.equal(byId["milestone-status"].text, "No active Master Milestones are recorded for the visible projects.");
});

test("Viewer with every project withheld: no chart reads as zero or 'none'", () => {
  const { byId } = panelsFor([
    row({ id: "p-h1", name: HIDDEN_NAME, detailAvailable: false }),
    row({ id: "p-h2", name: "Second Hidden", detailAvailable: false }),
  ]);

  assert.match(byId["risk-priority"].text, /Risk detail is restricted at your access level for all 2 projects/);
  assert.match(byId["milestone-status"].text, /Master Milestone detail is restricted/);

  const attention = byId.attention;
  assert.ok(attention.items.every((item) => item.display === "—"), "every zero count shows as —");
  assert.equal(attention.subtitle, "Open exceptions across the visible projects");
  assert.match(attention.note, /operational detail is restricted for 2 projects/);
});

test("Partial access: visible risks still chart, qualified — and the withheld project is never named", () => {
  const { byId } = panelsFor([
    row({ id: "p-visible", name: "Visible Plant", risks: [risk("p-visible", "Visible Plant", "Late vendor dossiers")], milestoneStates: [MILESTONE] }),
    row({ id: "p-hidden", name: HIDDEN_NAME, detailAvailable: false }),
  ]);

  const risks = byId["risk-priority"];
  assert.equal(risks.kind, "hbars");
  assert.equal(risks.rows.reduce((sum, bar) => sum + bar.value, 0), 1, "only the visible risk is counted");
  assert.match(risks.note, /Visible projects only — risk detail is restricted for 1 project/);

  const attention = byId.attention;
  const openRisks = attention.items.find((item) => item.label === "Open Risks");
  assert.equal(openRisks.value, 1);
  assert.equal(openRisks.display, undefined, "a real visible count is shown as a number");
  const decisions = attention.items.find((item) => item.label === "Decisions Required");
  assert.equal(decisions.display, "—", "a zero over a partly hidden portfolio is not asserted");

  assert.equal(byId["milestone-status"].kind, "donut");
  assert.match(byId["milestone-status"].note, /Master Milestone detail is restricted for 1 project/);

  const everyString = JSON.stringify(Object.values(byId).map(({ text, note, subtitle }) => [text, note, subtitle]));
  assert.doesNotMatch(everyString, new RegExp(HIDDEN_NAME));
});

test("Permitted register aggregates are unaffected by restriction", () => {
  const rows = [
    row({ id: "p-visible", name: "Visible Plant" }),
    row({ id: "p-hidden", name: HIDDEN_NAME, detailAvailable: false, health: "delayed" }),
  ];
  const { aggregate, byId } = panelsFor(rows);
  assert.equal(aggregate.planned, 60);
  assert.equal(aggregate.actual, 55);
  assert.equal(aggregate.health.delayed, 1, "health is a published register reading, still counted");
  assert.equal(byId.health.kind, "donut");
  assert.equal(byId["planned-actual"].kind, "hgrouped");
  assert.equal(byId["planned-actual"].rows.length, 2);
});

/* ------------------------------ Executive Summary ---------------------------- */

test("Executive Summary: full access carries no restriction wording", () => {
  const rows = [
    row({ id: "p-a", name: "Alpha", risks: [risk("p-a", "Alpha", "Late vendor dossiers")] }),
    row({ id: "p-b", name: "Beta" }),
  ];
  const text = draftExecutiveNarrative({ rows, aggregate: aggregatePortfolio(rows), monthLabel: "September 2026" });
  assert.match(text, /The principal management concern is Late vendor dossiers \(Alpha\)\./);
  assert.doesNotMatch(text, /restricted|access level/);
});

test("Executive Summary: partial access qualifies the concern and counts — never names — withheld projects", () => {
  const rows = [
    row({ id: "p-visible", name: "Visible Plant", risks: [risk("p-visible", "Visible Plant", "Late vendor dossiers")] }),
    row({ id: "p-hidden", name: HIDDEN_NAME, detailAvailable: false }),
  ];
  const text = draftExecutiveNarrative({ rows, aggregate: aggregatePortfolio(rows), monthLabel: "September 2026" });
  assert.match(text, /principal management concern among the projects visible at this access level is Late vendor dossiers/);
  assert.match(text, /restricted at this access level for 1 of 2 projects/);
  assert.doesNotMatch(text, new RegExp(HIDDEN_RISK));
});

test("Executive Summary: fully withheld portfolio states that no attention conclusion can be drawn", () => {
  const rows = [
    row({ id: "p-h1", name: HIDDEN_NAME, detailAvailable: false }),
    row({ id: "p-h2", name: "Second Hidden", detailAvailable: false }),
  ];
  const text = draftExecutiveNarrative({ rows, aggregate: aggregatePortfolio(rows), monthLabel: "September 2026" });
  assert.match(text, /restricted at this access level for all 2 projects in view, so no management-attention conclusion can be drawn/);
  assert.doesNotMatch(text, /principal management concern/);
});
