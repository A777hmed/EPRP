/**
 * Shared formatting helpers and section primitives for the Executive document,
 * the Project Executive cards and the Executive Project Brief.
 *
 * Pulled out of `executive-document.tsx` so the cards/brief module (which the
 * document imports) never has to import the document back — a plain one-way
 * dependency instead of a cycle.
 */

import * as React from "react";
import { format, parseISO } from "date-fns";

import { NOT_REPORTED } from "./executive-data";

export function pct(value: number | undefined, digits = 1): string {
  return value === undefined ? NOT_REPORTED : `${value.toFixed(digits)}%`;
}

export function signed(value: number | undefined): string {
  if (value === undefined) return NOT_REPORTED;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function shortDate(value: string | undefined): string {
  if (!value) return "—";
  return format(parseISO(value), "dd MMM yyyy");
}

/**
 * Compact modifier for the Monthly-basis badges only ("Draft / Not Approved",
 * "No Monthly Report") — never the Schedule Health badge. See
 * `executive-document.tsx`'s original note: these sit inside a narrow column
 * or card header, where the default badge size is tight against its
 * neighbours; Schedule Health carries the primary reading and stays at its
 * normal size so it still reads as the heavier of the two.
 */
export const BASIS_BADGE_CLASS = "px-1.5 py-0 text-[0.62rem] leading-4";

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="monthly-empty-row">{children}</div>;
}

/**
 * Section shell used by every numbered block in the Executive document.
 *
 * A solid navy pill reads as "this is a headline the reader must not miss" —
 * right for Executive Summary and Management Attention. Applied indiscriminately
 * it reads as template chrome instead of hierarchy, so secondary sections pass
 * `accent={false}` for a plain navy heading + hairline, still numbered, still
 * legible.
 */
export function ReportSection({
  number,
  title,
  note,
  children,
  accent = true,
}: {
  /** Omitted for a cockpit-only section that has no print counterpart to be
      numbered against (e.g. "What Changed Since Last Approved Period") —
      no number renders at all, so there is nothing to hide. */
  number?: number;
  title: string;
  note?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section className="monthly-section">
      <div className={accent ? "monthly-section-title-row" : "monthly-section-title-row is-plain"}>
        <h2>
          <span>
            {/*
              The number is its own element so a section SHARED between the
              screen cockpit and the print report (Project Executive Status,
              Full Project Data — both `accent={false}`, both mounted once per
              medium) can hide the "N · " prefix on screen — it would
              otherwise dangle without the print-only numbered sections around
              it — while print keeps the full formal "N · Title". See
              `globals.css` for the screen-hide / print-restore rule.
            */}
            {number !== undefined && <span className="exec-section-number">{number} · </span>}
            {title}
          </span>
        </h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}
