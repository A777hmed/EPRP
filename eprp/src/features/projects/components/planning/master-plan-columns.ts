import { cn } from "@/lib/utils";

/**
 * Phase 13.11 UAT — the Master Plan table's one column grid.
 *
 * Header cells, body cells and the table's `<colgroup>` all read this model,
 * so each column's width, alignment and pinning is stated once and the
 * header can never drift from the rows beneath it.
 *
 * - ONE identity column, "Item" (name, then code and classification), is the
 *   only pinned column — from `xl` (≥ 1280 px) only; below that the whole
 *   table scrolls, which is the robust behaviour on narrow frames.
 * - Fixed widths under `table-layout: fixed`; the table scrolls sideways
 *   inside its frame, never the page.
 * - Numeric columns follow one rule: centred header and body, the same
 *   horizontal padding, tabular figures, and a deliberate two-line header
 *   whose help icon is glued to the end of the second line. Actions is
 *   centred too; every other column is left-aligned.
 * - Every header cell has the same fixed 64px height and type, with its label
 *   vertically centred; multi-word labels are stacked on explicit lines
 *   ("Local / weight"), never wrapped at random.
 * - Borders are drawn by the cells under `border-collapse: separate`, so the
 *   pinned cell covers what scrolls beneath it; a short fade in the row's own
 *   colour hides content that is only partly scrolled under the pin.
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
  /** The one pinned identity column. */
  sticky?: boolean;
}

export const MASTER_PLAN_COLUMNS: Record<MasterPlanColumn, MasterPlanColumnSpec> = {
  item: { header: ["Item"], width: 22, sticky: true },
  level: { header: ["Level"], width: 7.5 },
  method: { header: ["Earning", "method"], width: 10 },
  local: { header: ["Local", "weight"], width: 7, numeric: true },
  contribution: { header: ["Project", "contribution"], width: 8.5, numeric: true },
  children: { header: ["Children", "total"], width: 9, numeric: true },
  recorded: { header: ["Recorded", "weight"], width: 7.5, numeric: true },
  reports: { header: ["Reports in"], width: 12 },
  actions: { header: ["Actions"], width: 7.5 },
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
   scrolling under the pinned column never shows through — in both themes. */
export const MASTER_PLAN_HEAD_BG = "bg-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";
export const MASTER_PLAN_ROW_BG =
  "bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";

/**
 * The pinned Item column (xl and up): a divider closes it, and a 16px fade
 * in the cell's own colour hides the trailing pixels of a column that is
 * only partly scrolled beneath it (an ellipsis dot, a sliver of a dash).
 */
const STICKY =
  "xl:sticky xl:left-0 xl:border-r xl:after:pointer-events-none xl:after:absolute xl:after:inset-y-0 xl:after:left-[calc(100%+1px)] xl:after:w-4 xl:after:bg-linear-to-r xl:after:to-transparent";
const FADE_HEAD = "xl:after:from-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";
const FADE_ROW =
  "xl:after:from-card xl:group-hover/row:after:from-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";

export const MASTER_PLAN_TABLE_CLASS = "table-fixed border-separate border-spacing-0";

/** Horizontal padding shared by every header and body cell. */
const CELL_X = "px-3";

export function masterPlanHeadCell(key: MasterPlanColumn): string {
  const column = MASTER_PLAN_COLUMNS[key];
  return cn(
    // One fixed 64px height for every header, every label vertically centred
    // in it. Lines are explicit (see `header`), so nothing wraps on its own.
    "h-16 border-b py-0 align-middle text-xs leading-4 font-medium whitespace-nowrap",
    CELL_X,
    MASTER_PLAN_HEAD_BG,
    // Numeric columns and Actions are centred, header and body alike.
    (column.numeric || key === "actions") && "text-center",
    column.sticky && cn(STICKY, "z-20", FADE_HEAD)
  );
}

export function masterPlanBodyCell(key: MasterPlanColumn): string {
  const column = MASTER_PLAN_COLUMNS[key];
  return cn(
    "border-b py-2 text-xs group-last/row:border-b-0",
    CELL_X,
    column.numeric && "text-center tabular-nums",
    (key === "contribution" || key === "recorded") && "text-muted-foreground",
    key === "item" && "whitespace-normal",
    key === "actions" && "text-center",
    column.sticky && cn(STICKY, "z-10", MASTER_PLAN_ROW_BG, FADE_ROW)
  );
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
