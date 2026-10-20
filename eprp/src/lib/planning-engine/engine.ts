import { dayNumber, WorkingCalendar } from "./calendar";
import { earnedPercentAt, plannedPercentAt } from "./earning";
import {
  figure,
  type ElementPerformance,
  type EngineElementInput,
  type EnginePlanInput,
  type PlanCalculation,
  type PlanningFigure,
} from "./types";
import { blockingIssues, validatePlan } from "./validation";

/**
 * The performance calculation (`02` §26.4):
 *
 *   EW(x)          = Π local_weight / 100 over x and its ancestors below the Project
 *   Node PV / EV   = Σ child_local_weight × child PV (EV) / 100
 *   Project PV/EV  = Σ over leaf activities EW × activity PV (EV)
 *                    — identical to rolling up level by level
 *   SV             = EV − PV (points)
 *   SPI            = EV ÷ PV, "N/A" when PV = 0
 *
 * Both paths are computed on every run and must agree (`02` §26.5: "an engine
 * test, not a convention"). The existing flat roll-up in
 * `lib/planning-rollup.ts` is untouched: it keeps serving legacy snapshots,
 * which are never re-derived (`02` §26.8 invariant 5).
 */

/**
 * Recorded with every figure the engine produces. 13.12 freezes it into each
 * v2 snapshot so a later engine change never alters published history
 * (`02` §26.7 rule 2). Bump it whenever a calculation result could change.
 */
export const PLANNING_ENGINE_VERSION = "1.0.0";

/** Agreement tolerance between the two calculation paths, in points. */
const CROSS_CHECK_TOLERANCE = 1e-9;

export function spiFigure(pv: number, ev: number): PlanningFigure {
  return pv > 0 ? figure.value(ev / pv) : figure.notApplicable("pv_zero");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Effective project contribution of every element, in percent (W4: always
 * calculated). Reads local weights only; unentered weights contribute 0 here,
 * which is why the calculation itself refuses a plan with W1 / W2 findings.
 */
export function effectiveWeights(plan: Pick<EnginePlanInput, "children">): Map<string, number> {
  const result = new Map<string, number>();
  const walk = (children: readonly EngineElementInput[], parentFraction: number) => {
    for (const child of children) {
      const fraction = parentFraction * ((child.localWeight ?? 0) / 100);
      result.set(child.id, fraction * 100);
      if (child.kind === "node") walk(child.children, fraction);
    }
  };
  walk(plan.children, 1);
  return result;
}

/**
 * Validate, then calculate. A plan with any blocking finding is refused as a
 * whole — never partially calculated (W2, C2).
 */
export function calculatePlanPerformance(plan: EnginePlanInput): PlanCalculation {
  const issues = validatePlan(plan);
  const blocking = blockingIssues(issues);
  if (blocking.length > 0) return { status: "blocked", issues: blocking };

  const calendar = new WorkingCalendar(plan.workingWeek);
  const dataDay = dayNumber(plan.dataDate) as number;
  const elements: ElementPerformance[] = [];
  let effectivePv = 0;
  let effectiveEv = 0;

  const visit = (
    element: EngineElementInput,
    parentId: string | null,
    depth: number,
    parentFraction: number
  ): { pv: number; ev: number } => {
    const localWeight = element.localWeight as number;
    const fraction = parentFraction * (localWeight / 100);
    const row: ElementPerformance = {
      id: element.id,
      kind: element.kind,
      code: element.code ?? null,
      name: element.name,
      parentId,
      depth,
      localWeight,
      effectiveWeight: fraction * 100,
      pv: 0,
      ev: 0,
      sv: 0,
      spi: figure.notApplicable("pv_zero"),
      pvContribution: 0,
      evContribution: 0,
      isControlAccount: element.kind === "node" && element.isControlAccount === true,
      earningMethod: element.kind === "activity" ? element.earningMethod : null,
    };
    elements.push(row);

    let pv: number;
    let ev: number;
    if (element.kind === "activity") {
      const planned = plannedPercentAt(element.earningMethod, element.baseline, dataDay, calendar);
      const earned = earnedPercentAt(element, dataDay);
      if (planned === null || earned === null) {
        // Validation guarantees both; reaching here is an engine defect.
        throw new Error(`Planning engine: ${element.name} passed validation without a PV or EV.`);
      }
      pv = planned;
      ev = earned;
      effectivePv += fraction * pv;
      effectiveEv += fraction * ev;
    } else {
      pv = 0;
      ev = 0;
      for (const child of element.children) {
        const result = visit(child, element.id, depth + 1, fraction);
        pv += ((child.localWeight as number) * result.pv) / 100;
        ev += ((child.localWeight as number) * result.ev) / 100;
      }
    }

    row.pv = pv;
    row.ev = ev;
    row.sv = ev - pv;
    row.spi = spiFigure(pv, ev);
    row.pvContribution = (row.effectiveWeight * pv) / 100;
    row.evContribution = (row.effectiveWeight * ev) / 100;
    return { pv, ev };
  };

  let projectPv = 0;
  let projectEv = 0;
  for (const child of plan.children) {
    const result = visit(child, null, 1, 1);
    projectPv += ((child.localWeight as number) * result.pv) / 100;
    projectEv += ((child.localWeight as number) * result.ev) / 100;
  }

  const maxDifference = Math.max(Math.abs(projectPv - effectivePv), Math.abs(projectEv - effectiveEv));
  if (maxDifference > CROSS_CHECK_TOLERANCE) {
    throw new Error(`Planning engine: calculation paths disagree by ${maxDifference} points.`);
  }

  return deepFreeze({
    status: "calculated",
    performance: {
      engineVersion: PLANNING_ENGINE_VERSION,
      projectId: plan.projectId,
      dataDate: plan.dataDate,
      project: { pv: projectPv, ev: projectEv, sv: projectEv - projectPv, spi: spiFigure(projectPv, projectEv) },
      elements,
      crossCheck: {
        levelByLevel: { pv: projectPv, ev: projectEv },
        effectiveWeights: { pv: effectivePv, ev: effectiveEv },
        maxDifference,
      },
      advisories: issues.filter((finding) => finding.severity === "advisory"),
    },
  });
}
