/**
 * `docs/02` §26.5 worked example — Project → RBI → VDU / CDU / Utilities —
 * as an engine input (Phase 13.10 acceptance fixture). Test-only.
 *
 * Data Date Sat 31 Oct 2026; working week Sun – Thu (Thu 29 Oct is the last
 * working day on or before it). BLn windows are chosen to give exactly the
 * elapsed working days the example states, e.g. VDU-A20 "16 of 20".
 *
 * HAZOP and SIL are "shown rolled up" in the example; each is one Percent
 * Complete activity giving the stated 70 / 66 and 30 / 30.
 */

export const DATA_DATE = "2026-10-31";
export const WORKING_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday"];

const done = (start, finish) => ({ start, finish });

export function worked265() {
  return {
    projectId: "project-265",
    dataDate: DATA_DATE,
    workingWeek: WORKING_WEEK,
    children: [
      {
        kind: "node",
        id: "rbi",
        code: "RBI",
        name: "RBI",
        localWeight: 10,
        isControlAccount: true,
        children: [
          {
            kind: "node",
            id: "vdu",
            name: "VDU",
            localWeight: 40,
            children: [
              {
                kind: "activity",
                id: "vdu-a10",
                code: "VDU-A10",
                name: "Data collection",
                localWeight: 30,
                earningMethod: "percent_complete",
                baseline: { start: "2026-09-01", finish: "2026-09-30" },
                actual: done("2026-09-01", "2026-09-30"),
                percentComplete: 100,
              },
              {
                kind: "activity",
                id: "vdu-a20",
                code: "VDU-A20",
                name: "Damage mechanisms & corrosion loops",
                localWeight: 40,
                earningMethod: "percent_complete",
                // Thu 8 Oct → Wed 4 Nov: 20 working days, 16 elapsed by 29 Oct.
                baseline: { start: "2026-10-08", finish: "2026-11-04" },
                forecast: { finish: "2026-11-12" },
                actual: { start: "2026-10-08" },
                percentComplete: 60,
              },
              {
                kind: "activity",
                id: "vdu-a30",
                code: "VDU-A30",
                name: "Draft RBI report",
                localWeight: 30,
                earningMethod: "percent_complete",
                // Mon 26 Oct → Sun 22 Nov: 20 working days, 4 elapsed.
                baseline: { start: "2026-10-26", finish: "2026-11-22" },
                forecast: { start: "2026-11-01", finish: "2026-11-30" },
              },
              {
                kind: "activity",
                id: "vdu-m10",
                code: "VDU-M10",
                name: "VDU RBI Final Report Approved",
                localWeight: 0,
                earningMethod: "milestone",
                isKeyMilestone: true,
                originalBaseline: { finish: "2026-12-01" },
                baseline: { finish: "2026-12-15" },
                forecast: { finish: "2026-12-29" },
              },
            ],
          },
          {
            kind: "node",
            id: "cdu",
            name: "CDU",
            localWeight: 35,
            children: [
              {
                kind: "activity",
                id: "cdu-a10",
                code: "CDU-A10",
                name: "Data collection",
                localWeight: 40,
                earningMethod: "fifty_fifty",
                baseline: { start: "2026-09-01", finish: "2026-09-30" },
                actual: done("2026-09-01", "2026-09-30"),
              },
              {
                kind: "activity",
                id: "cdu-a20",
                code: "CDU-A20",
                name: "Corrosion assessment",
                localWeight: 60,
                earningMethod: "percent_complete",
                baseline: { start: "2026-10-26", finish: "2026-11-22" },
                forecast: { finish: "2026-11-26" },
                actual: { start: "2026-10-26" },
                percentComplete: 15,
              },
            ],
          },
          {
            kind: "node",
            id: "utl",
            name: "Utilities",
            localWeight: 25,
            children: [
              {
                kind: "activity",
                id: "utl-a10",
                code: "UTL-A10",
                name: "Site walkdown",
                localWeight: 20,
                earningMethod: "zero_hundred",
                baseline: { start: "2026-10-01", finish: "2026-10-15" },
                actual: done("2026-10-04", "2026-10-14"),
              },
              {
                kind: "activity",
                id: "utl-a20",
                code: "UTL-A20",
                name: "Data collection",
                localWeight: 80,
                earningMethod: "percent_complete",
                baseline: { start: "2026-11-01", finish: "2026-11-26" },
                forecast: { finish: "2026-11-26" },
                actual: { start: "2026-10-28" },
                percentComplete: 5,
              },
            ],
          },
        ],
      },
      {
        kind: "node",
        id: "hazop",
        name: "HAZOP",
        localWeight: 50,
        isControlAccount: true,
        children: [
          {
            kind: "activity",
            id: "hazop-a10",
            name: "HAZOP sessions",
            localWeight: 100,
            earningMethod: "percent_complete",
            // Mon 12 Oct → Sun 8 Nov: 20 working days, 14 elapsed → 70.
            baseline: { start: "2026-10-12", finish: "2026-11-08" },
            forecast: { finish: "2026-11-10" },
            actual: { start: "2026-10-12" },
            percentComplete: 66,
          },
        ],
      },
      {
        kind: "node",
        id: "sil",
        name: "SIL",
        localWeight: 40,
        isControlAccount: true,
        children: [
          {
            kind: "activity",
            id: "sil-a10",
            name: "SIL assessment",
            localWeight: 100,
            earningMethod: "percent_complete",
            // Thu 22 Oct → Wed 18 Nov: 20 working days, 6 elapsed → 30.
            baseline: { start: "2026-10-22", finish: "2026-11-18" },
            forecast: { finish: "2026-11-18" },
            actual: { start: "2026-10-22" },
            percentComplete: 30,
          },
        ],
      },
    ],
  };
}

/** Deep copy of a plan, so a test can mutate one copy as a "draft edit". */
export function clone(value) {
  return structuredClone(value);
}

/** Find an element by id anywhere in a plan input. */
export function findInput(plan, id) {
  const walk = (children) => {
    for (const child of children) {
      if (child.id === id) return child;
      if (child.kind === "node") {
        const found = walk(child.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(plan.children);
}
