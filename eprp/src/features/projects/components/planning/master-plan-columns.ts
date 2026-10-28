import { cn } from "@/lib/utils";

/**
 * Phase 13.11 UAT — the Master Plan table's one column grid; 13.12 closure
 * polish (presentation only).
 *
 * Header cells, body cells and the table's `<colgroup>` all read this model,
 * so each column's width, alignment and pinning is stated once and the
 * header can never drift from the rows beneath it. PSM and Other projects use
 * the same model, so the two can never differ visually.
 *
 * - ONE identity column, "Item" (name, then code and classification), pinned
 *   on the left from `xl` (≥ 1280 px); below that it scrolls with the rest.
 * - "Actions" is pinned on the right at every width, so a row's actions are
 *   never scrolled out of reach.
 * - Fixed widths under `table-layout: fixed`; the table scrolls sideways
 *   inside its frame, never the page.
 * - Numeric columns follow one rule: right-aligned header and body, the same
 *   horizontal padding, tabular figures, so Local weight, Project
 *   contribution and Children total compare digit for digit. Their two-line
 *   header keeps its help icon glued to the end of the second line.
 * - Every header cell has the same fixed 56px height and quiet small-caps
 *   type, with its label vertically centred; multi-word labels are stacked on
 *   explicit lines ("Local / weight"), never wrapped at random.
 * - Every body row is two lines high (name over code · classification), so
 *   rows keep one height however long a name is; the full text is in `title`.
 * - Planning nodes at the first level read as group rows (a quiet band);
 *   deeper rows indent under them with a thin guide per ancestor level.
 * - Every body cell paints its own solid background (row band, hover and
 *   keyboard focus alike), so pinned and scrolling cells never differ in
 *   shade, in either theme. Borders are drawn by the cells under
 *   `border-collapse: separate`; a short fade in the cell's own colour hides
 *   content only partly scrolled beneath a pinned column.
 *
 * Layout only: nothing here reads or changes a planning value.
 */

export type MasterPlanColumn =
  | "item"
  | "level"
  | "method"
  | "local"
  | "contribution"
  | "children"
  | "recorded"
  | "reports"
  | "actions";

export interface MasterPlanColumnSpec {
  /** The header text, one entry per line (numeric headers are always two lines). */
  header: readonly string[];
  /** rem. */
  width: number;
  numeric?: boolean;
  /** Pinned: the identity column on the left (from xl), Actions on the right (always). */
  sticky?: "start" | "end";
}

export const MASTER_PLAN_COLUMNS: Record<MasterPlanColumn, MasterPlanColumnSpec> = {
  item: { header: ["Item"], width: 22, sticky: "start" },
  level: { header: ["Level"], width: 8 },
  method: { header: ["Earning", "method"], width: 9.5 },
  local: { header: ["Local", "weight"], width: 6.5, numeric: true },
  contribution: { header: ["Project", "contribution"], width: 8, numeric: true },
  children: { header: ["Children", "total"], width: 8.5, numeric: true },
  recorded: { header: ["Recorded", "weight"], width: 7, numeric: true },
  reports: { header: ["Reports in"], width: 11.5 },
  actions: { header: ["Actions"], width: 6.5, sticky: "end" },
};

/** The column's header as one accessible label, e.g. "Project contribution". */
export function masterPlanColumnLabel(key: MasterPlanColumn): string {
  return MASTER_PLAN_COLUMNS[key].header.join(" ");
}

export function masterPlanColumns(showRecorded: boolean): MasterPlanColumn[] {
  return [
    "item",
    "level",
    "method",
    "local",
    "contribution",
    "children",
    ...(showRecorded ? (["recorded"] as const) : []),
    "reports",
    "actions",
  ];
}

/** The table's width in rem: the sum of its columns. */
export function masterPlanTableMinWidth(columns: readonly MasterPlanColumn[]): number {
  return columns.reduce((sum, key) => sum + MASTER_PLAN_COLUMNS[key].width, 0);
}

/* Solid (non-translucent) backgrounds, mixed from theme tokens, so content
   scrolling under a pinned column never shows through — in both themes. The
   row states are driven by the row (`group/row`): hover, and keyboard focus
   inside the row, look the same. */
export const MASTER_PLAN_HEAD_BG = "bg-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";
export const MASTER_PLAN_ROW_BG =
  "bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-has-[:focus-visible]/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";
/** A first-level planning node: a quiet band that groups the rows beneath it. */
export const MASTER_PLAN_BAND_BG =
  "bg-[color-mix(in_oklab,var(--muted)_32%,var(--card))] group-hover/row:bg-[color-mix(in_oklab,var(--muted)_58%,var(--card))] group-has-[:focus-visible]/row:bg-[color-mix(in_oklab,var(--muted)_58%,var(--card))]";

/** How a body row is painted. */
export type MasterPlanRowTone = "band" | "plain";

/**
 * The pinned Item column (xl and up): a divider closes it, and a 16px fade
 * in the cell's own colour hides the trailing pixels of a column that is
 * only partly scrolled beneath it (an ellipsis dot, a sliver of a dash).
 */
const STICKY_START =
  "xl:sticky xl:left-0 xl:border-r xl:after:pointer-events-none xl:after:absolute xl:after:inset-y-0 xl:after:left-[calc(100%+1px)] xl:after:w-4 xl:after:bg-linear-to-r xl:after:to-transparent";
const FADE_START_HEAD = "xl:after:from-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";
const FADE_START_ROW =
  "xl:after:from-card xl:group-hover/row:after:from-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";
const FADE_START_BAND =
  "xl:after:from-[color-mix(in_oklab,var(--muted)_32%,var(--card))] xl:group-hover/row:after:from-[color-mix(in_oklab,var(--muted)_58%,var(--card))]";

/** The pinned Actions column (every width): the same divider and fade, mirrored. */
const STICKY_END =
  "sticky right-0 border-l before:pointer-events-none before:absolute before:inset-y-0 before:right-[calc(100%+1px)] before:w-4 before:bg-linear-to-l before:to-transparent";
const FADE_END_HEAD = "before:from-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";
const FADE_END_ROW =
  "before:from-card group-hover/row:before:from-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";
const FADE_END_BAND =
  "before:from-[color-mix(in_oklab,var(--muted)_32%,var(--card))] group-hover/row:before:from-[color-mix(in_oklab,var(--muted)_58%,var(--card))]";

export const MASTER_PLAN_TABLE_CLASS = "table-fixed border-separate border-spacing-0";

/** Horizontal padding shared by every header and body cell. */
const CELL_X = "px-3";

export function masterPlanHeadCell(key: MasterPlanColumn): string {
  const column = MASTER_PLAN_COLUMNS[key];
  return cn(
    // One fixed 56px height for every header, every label vertically centred
    // in it. Lines are explicit (see `header`), so nothing wraps on its own.
    "h-14 border-b py-0 align-middle text-[11px] leading-4 font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap",
    CELL_X,
    MASTER_PLAN_HEAD_BG,
    column.numeric && "text-right",
    key === "actions" && "text-center",
    column.sticky === "start" && cn(STICKY_START, "z-20", FADE_START_HEAD),
    column.sticky === "end" && cn(STICKY_END, "z-20", FADE_END_HEAD)
  );
}

export function masterPlanBodyCell(key: MasterPlanColumn, tone: MasterPlanRowTone = "plain"): string {
  const column = MASTER_PLAN_COLUMNS[key];
  const band = tone === "band";
  return cn(
    "h-[3.25rem] border-b py-1.5 align-middle text-xs",
    CELL_X,
    band ? MASTER_PLAN_BAND_BG : MASTER_PLAN_ROW_BG,
    column.numeric && "text-right tabular-nums",
    (key === "contribution" || key === "recorded") && "text-muted-foreground",
    key === "item" && "whitespace-normal",
    key === "actions" && "text-center",
    column.sticky === "start" && cn(STICKY_START, "z-10", band ? FADE_START_BAND : FADE_START_ROW),
    column.sticky === "end" && cn(STICKY_END, "z-10", band ? FADE_END_BAND : FADE_END_ROW)
  );
}

/* ------------------------------- Hierarchy -------------------------------- */

/** px of indent per planning level inside the Item column. */
export const MASTER_PLAN_INDENT_STEP = 16;
const INDENT_BASE = 12;

/**
 * The Item cell's indent and its tree guides: one 1px line per ancestor
 * level, centred under that ancestor's first characters, in the border
 * colour. Drawn as backgrounds, so it never changes layout or the cell's
 * own background colour.
 */
export function masterPlanItemIndent(depth: number): {
  paddingLeft: number;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
} {
  const level = Math.max(1, depth);
  const paddingLeft = INDENT_BASE + (level - 1) * MASTER_PLAN_INDENT_STEP;
  if (level === 1) return { paddingLeft };
  const guides = Array.from({ length: level - 1 }, (_, index) => INDENT_BASE + index * MASTER_PLAN_INDENT_STEP + 4);
  return {
    paddingLeft,
    backgroundImage: guides.map(() => "linear-gradient(var(--border), var(--border))").join(", "),
    backgroundSize: guides.map(() => "1px 100%").join(", "),
    backgroundPosition: guides.map((x) => `${x}px 0`).join(", "),
    backgroundRepeat: "no-repeat",
  };
}

/* ------------------------------- Formatting ------------------------------- */

/** A stored weight as shown in the table; `null` when there is none. */
export function formatWeight(value: number | null | undefined): string | null {
  return value === undefined || value === null ? null : `${value}%`;
}

/** A calculated contribution, to 3 decimals; never typed (W4). */
export function formatContribution(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/** "A → B → C" as its last unit and the path above it. */
export function splitUnitPath(text: string): { unit: string; path: string } {
  const parts = text.split(" → ");
  return { unit: parts[parts.length - 1] ?? text, path: parts.slice(0, -1).join(" → ") };
}
