/**
 * The Next Week Plan's timeline axis, and where each task sits on it.
 *
 * PURE. Every function here is a derivation over data the Weekly report and its
 * project already carry — the reporting period, the project's working week, and
 * a plan item's own `start_date` / `end_date`. Nothing is fetched, nothing is
 * stored, and no date is invented: a column exists only because a real calendar
 * day falls in the window, and a bar is drawn only from dates a user recorded.
 *
 * WHY THE AXIS IS DERIVED FROM THE REPORT, NOT FROM TODAY. A Weekly report is
 * read long after the week it covers — during review, at sign-off, from the
 * Monthly consolidation, out of the archive. An axis anchored to `new Date()`
 * would show a different week every time the same report was opened, and would
 * be wrong for every report but the current one. The report's own `periodEnd`
 * is the only stable anchor.
 */

import type { IsoDate, WeeklyPlanItem } from "@/types";

/* ------------------------------- Working week ------------------------------ */

/** JS `getDay()` indices, so the names below map straight onto a Date. */
const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const DAY_LABEL = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The project's working week, as day indices in the order they are worked.
 *
 * `project.reporting.workingWeek` is a LABEL, not structured data: the column
 * is `text not null default 'Sun – Thu'` and the application offers four
 * choices ("Sun – Thu", "Sat – Thu", "Mon – Fri", "Sat – Wed"). Rather than a
 * lookup table that silently fails the day a fifth option is added, this parses
 * the two endpoints and walks forward between them, wrapping over Saturday.
 * That handles all four of today's options and anything shaped like them.
 *
 * An unparseable value falls back to Sun–Thu — the schema default and the
 * regional norm for this platform — because a plan with no axis at all would be
 * worse than one on the default axis, and the real dates are on every row
 * regardless.
 */
export function workingWeekDays(workingWeek: string | undefined): number[] {
  const fallback = [0, 1, 2, 3, 4];
  if (!workingWeek) return fallback;

  // Any dash (hyphen, en, em) with optional surrounding space.
  const parts = workingWeek
    .split(/\s*[–—-]\s*/)
    .map((part) => part.trim().slice(0, 3).toLowerCase())
    .filter(Boolean);

  if (parts.length !== 2) return fallback;
  const from = DAY_INDEX[parts[0]];
  const to = DAY_INDEX[parts[1]];
  if (from === undefined || to === undefined) return fallback;

  const days: number[] = [];
  for (let step = 0; step < 7; step += 1) {
    const day = (from + step) % 7;
    days.push(day);
    if (day === to) break;
  }
  return days;
}

/* --------------------------------- The window ------------------------------ */

export interface NextWeekDay {
  /** The real calendar day this column stands for. */
  date: IsoDate;
  /** "SUN", "MON" … — the column heading. */
  label: string;
  /** Day of month, for the secondary line under the heading. */
  dayOfMonth: number;
}

/** Midday, so a whole-day date can never be dragged across a boundary. */
function parseIso(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/**
 * The working days that follow the reporting period, up to the end of their
 * own working week.
 *
 * Starts at the first working day strictly after `periodEnd` and runs forward
 * until the working week turns over — that is, until the working week's own
 * first day comes round again. Every column is therefore a real calendar day,
 * after the report's period, and inside ONE working week.
 *
 * That last part is why this is not simply "the working days in the next seven
 * calendar days". A project's reporting week and its working week need not be
 * aligned — a Mon–Sun reporting period against a Sun–Thu working week is
 * ordinary — and a naive seven-day sweep then runs Mon, Tue, Wed, Thu and
 * wraps onto the SUNDAY OF THE WEEK AFTER, putting two different working weeks
 * on one axis and captioning the whole thing "next week". Stopping at the
 * turnover gives four honest columns instead of five misleading ones.
 */
export function nextWeekWindow(
  periodEnd: string | undefined,
  workingWeek: string | undefined
): NextWeekDay[] {
  if (!periodEnd) return [];
  const anchor = parseIso(periodEnd);
  if (Number.isNaN(anchor.getTime())) return [];

  const order = workingWeekDays(workingWeek);
  const working = new Set(order);
  const weekStartsOn = order[0];
  const days: NextWeekDay[] = [];

  for (let offset = 1; offset <= 7; offset += 1) {
    const day = new Date(anchor);
    day.setDate(day.getDate() + offset);
    const weekday = day.getDay();
    if (!working.has(weekday)) continue;
    // The working week has turned over; what follows belongs to the week after.
    if (weekday === weekStartsOn && days.length > 0) break;
    days.push({
      date: toIso(day),
      label: DAY_LABEL[weekday],
      dayOfMonth: day.getDate(),
    });
  }

  return days;
}

/* ------------------------------ Bar placement ------------------------------ */

export type PlacementKind = "span" | "marker" | "outside";

export interface BarPlacement {
  kind: PlacementKind;
  /** Inclusive column indices into the window. Absent when `outside`. */
  startIndex?: number;
  endIndex?: number;
  /** The real span reaches back before the first column. */
  clippedStart: boolean;
  /** The real span reaches past the last column. */
  clippedEnd: boolean;
}

const OUTSIDE: BarPlacement = {
  kind: "outside",
  clippedStart: false,
  clippedEnd: false,
};

/**
 * Where one task's bar sits on the axis — or that it does not sit on it at all.
 *
 * THE DATES IN THE ROW ARE THE TRUTH; the bar is a picture of them. Three rules
 * follow from that:
 *
 *   * A task reaching outside the window is CLIPPED to the window and says so,
 *     rather than being rescaled — a bar that ran to the edge would claim the
 *     task ends on Thursday when it does not. The row still prints both real
 *     dates.
 *   * A task with no `start_date` (the column is nullable) is a single-day
 *     MARKER on its end date, not a bar guessed backwards from it.
 *   * A task wholly outside the window gets no placement at all. It is listed
 *     with its real dates and labelled, never drawn somewhere convenient.
 *
 * A date that lands on a non-working day has no column of its own. It is
 * resolved to the nearest working column INSIDE the window — later for a start,
 * earlier for an end — which is a statement about where to draw, not about when
 * the work happens. The row's own Start and End cells remain the record.
 */
export function placeOnWindow(
  item: Pick<WeeklyPlanItem, "startDate" | "endDate">,
  window: NextWeekDay[]
): BarPlacement {
  if (window.length === 0 || !item.endDate) return OUTSIDE;

  const first = window[0].date;
  const last = window[window.length - 1].date;
  const start = item.startDate ?? item.endDate;
  const end = item.endDate;

  // ISO dates compare correctly as strings.
  if (end < first || start > last) return OUTSIDE;

  const startIndex = window.findIndex((day) => day.date >= start);
  let endIndex = -1;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (window[index].date <= end) {
      endIndex = index;
      break;
    }
  }

  // Both ends fell between working days on the same side of the window.
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return OUTSIDE;
  }

  if (!item.startDate) {
    return {
      kind: "marker",
      startIndex: endIndex,
      endIndex,
      clippedStart: false,
      clippedEnd: end > last,
    };
  }

  return {
    kind: "span",
    startIndex,
    endIndex,
    clippedStart: start < first,
    clippedEnd: end > last,
  };
}
