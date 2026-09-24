"use client";

/**
 * "Project Progress Comparison" — Dashboard UX Part 1, item 5.
 *
 * Replaces the single-project curve as the Dashboard's default progress
 * panel. Every visible project's LATEST governed position, Planned against
 * Actual, one row per project — never blended into a single portfolio
 * figure (no governed project-weight model exists to blend them with).
 * Worst variance sorts first; a project with no planned/actual on record
 * says so explicitly rather than plotting a false zero.
 */

import * as React from "react";

import { HEALTH_META, type ProjectPosition } from "../dashboard-data";
import { Panel, PanelEmpty } from "../dashboard-analytics";
import { pct, signedPct, varianceTone } from "./dashboard-format";

/** Projects without a real variance sort after every project that has one. */
function rankOf(position: ProjectPosition): number {
  return typeof position.variance === "number" ? position.variance : Number.POSITIVE_INFINITY;
}

const VISIBLE_ROWS = 6;

export function ProjectProgressComparisonPanel({
  positions,
  onExpand,
}: {
  positions: ProjectPosition[];
  onExpand: () => void;
}) {
  const rows = React.useMemo(() => [...positions].sort((a, b) => rankOf(a) - rankOf(b)), [positions]);
  const visible = rows.slice(0, VISIBLE_ROWS);
  const hiddenCount = rows.length - visible.length;

  return (
    <Panel
      title="Project Progress Comparison"
      hint="Latest governed position by project"
      onAction={rows.length ? onExpand : undefined}
      linkLabel="Expand"
      className="dash-compare-panel"
    >
      {rows.length === 0 ? (
        <PanelEmpty>No project is in view for the current filters.</PanelEmpty>
      ) : (
        <>
          <ul
            /* Final Micro-Polish: keyed on the visible rows' own values (not
               `positions` identity, which changes on incidental re-renders
               too) — the list cleanly re-mounts and its dots/connectors
               replay their one ~500ms reveal exactly when the scope/filter
               change actually moves a number, never on an unrelated
               re-render, never looping. */
            key={visible.map((p) => `${p.project.id}:${p.planned ?? "x"}:${p.actual ?? "x"}`).join("|")}
            className="dash-compare"
          >
            {visible.map((position, index) => {
              const planned = position.planned;
              const actual = position.actual;
              const hasData = typeof planned === "number" && typeof actual === "number";
              const name = position.project.shortName?.trim() || position.project.name;

              return (
                <li
                  key={position.project.id}
                  className="dash-compare-row"
                  style={{ "--row-stagger": `${Math.min(index, 5) * 40}ms` } as React.CSSProperties}
                >
                  <div className="dash-compare-head">
                    <span className="dash-compare-name" title={position.project.name}>
                      {name}
                    </span>
                    <span className={`dash-compare-variance is-${hasData ? varianceTone(position.variance) : "default"}`}>
                      {hasData ? signedPct(position.variance) : "No Data"}
                    </span>
                  </div>
                  {hasData ? (
                    <div
                      className="dash-compare-track"
                      role="img"
                      aria-label={`${name}: planned ${pct(planned)}, actual ${pct(actual)}`}
                    >
                      <span
                        className="dash-compare-fill"
                        style={{
                          left: `${Math.min(planned, actual)}%`,
                          width: `${Math.max(0.5, Math.abs(actual - planned))}%`,
                          background: HEALTH_META[position.health].color,
                        }}
                      />
                      <span className="dash-compare-dot is-planned" style={{ left: `${planned}%` }} />
                      <span
                        className="dash-compare-dot is-actual"
                        style={{ left: `${actual}%`, background: HEALTH_META[position.health].color }}
                      />
                    </div>
                  ) : (
                    <p className="dash-compare-nodata">No planned or actual progress reported yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="dash-compare-legend" aria-hidden>
            <span className="is-planned">
              <i /> Planned
            </span>
            <span className="is-actual">
              <i /> Actual
            </span>
          </div>
          {hiddenCount > 0 && (
            <p className="dash-compare-more">
              +{hiddenCount} more {hiddenCount === 1 ? "project" : "projects"} — Expand for the full comparison
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
