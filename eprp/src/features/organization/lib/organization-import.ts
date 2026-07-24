/**
 * Excel import parsing for organization charts (OC-6).
 *
 * The spreadsheet side of the world is flat: one row per position, each
 * naming its parent by code. This module turns those rows into the nested
 * {@link PositionTreeInput} the services already understand, and reports
 * every problem it finds along the way rather than importing a broken chart.
 *
 * Kept free of any xlsx or React dependency so it can be compiled and tested
 * on its own — the wizard reads a file into rows, this decides what they mean.
 */

import type { PositionTreeInput } from "@/services/organization-chart-service";

/** The fields an import needs. Everything else in the sheet is ignored. */
export type ImportField = "code" | "title" | "parentCode" | "role";

/** Maps each field to the spreadsheet column header it comes from. */
export type ColumnMapping = Record<ImportField, string | null>;

/** One row after mapping, before validation. */
export interface ImportRow {
  /** 1-based row number in the sheet, for error messages. */
  rowNumber: number;
  code: string;
  title: string;
  parentCode: string;
  role: string;
}

export type ImportIssueSeverity = "error" | "warning";

export interface ImportIssue {
  severity: ImportIssueSeverity;
  /** The sheet row this concerns, or undefined for whole-file issues. */
  rowNumber?: number;
  code?: string;
  message: string;
}

export interface ImportStats {
  total: number;
  roots: number;
  maxDepth: number;
}

export interface ImportParseResult {
  rows: ImportRow[];
  issues: ImportIssue[];
  /** Built only when there are no blocking errors; empty otherwise. */
  tree: PositionTreeInput[];
  stats: ImportStats;
  /** True when the chart can be imported — no error-severity issues. */
  canImport: boolean;
}

/** The columns a downloadable template offers, in order. */
export const IMPORT_TEMPLATE_HEADERS = [
  "Code",
  "Title",
  "Parent Code",
  "Role",
] as const;

/** A couple of example rows for the downloadable template. */
export const IMPORT_TEMPLATE_SAMPLE: Record<string, string>[] = [
  { Code: "PD-01", Title: "Project Director", "Parent Code": "", Role: "Overall accountability" },
  { Code: "EM-01", Title: "Engineering Manager", "Parent Code": "PD-01", Role: "Design delivery" },
  { Code: "PRC-01", Title: "Procurement Manager", "Parent Code": "PD-01", Role: "Sourcing and vendors" },
  { Code: "ENG-PRO", Title: "Process Lead", "Parent Code": "EM-01", Role: "" },
];

const FIELD_SYNONYMS: Record<ImportField, string[]> = {
  code: ["code", "position code", "id", "position id"],
  title: ["title", "position", "position title", "name", "job title"],
  parentCode: [
    "parent code",
    "parent",
    "reports to",
    "reports to code",
    "manager code",
    "parent id",
  ],
  role: ["role", "responsibility", "function", "description"],
};

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Best-effort match of sheet headers to the fields we need, so the mapping
 * step opens pre-filled rather than blank. Unmatched fields come back null.
 */
export function guessColumnMapping(headers: string[]): ColumnMapping {
  const normalised = headers.map((header) => ({
    original: header,
    key: normaliseHeader(header),
  }));

  const pick = (field: ImportField): string | null => {
    for (const synonym of FIELD_SYNONYMS[field]) {
      const exact = normalised.find((column) => column.key === synonym);
      if (exact) return exact.original;
    }
    // Fall back to a looser contains match for the primary synonym.
    const primary = FIELD_SYNONYMS[field][0];
    const loose = normalised.find((column) => column.key.includes(primary));
    return loose?.original ?? null;
  };

  return {
    code: pick("code"),
    title: pick("title"),
    parentCode: pick("parentCode"),
    role: pick("role"),
  };
}

function cell(row: Record<string, unknown>, column: string | null): string {
  if (!column) return "";
  const value = row[column];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Turn mapped rows into normalised {@link ImportRow}s, dropping rows that are
 * entirely empty (trailing blank lines are common in exported sheets).
 */
export function mapRows(
  rawRows: Record<string, unknown>[],
  mapping: ColumnMapping
): ImportRow[] {
  const rows: ImportRow[] = [];
  rawRows.forEach((raw, index) => {
    const code = cell(raw, mapping.code);
    const title = cell(raw, mapping.title);
    const parentCode = cell(raw, mapping.parentCode);
    const role = cell(raw, mapping.role);
    if (!code && !title && !parentCode && !role) return; // blank line
    rows.push({
      // +2: one for the header row, one because sheets are 1-based.
      rowNumber: index + 2,
      code,
      title,
      parentCode,
      role,
    });
  });
  return rows;
}

/**
 * Validate the mapped rows and, when they hold together, build the tree.
 *
 * Errors block the import; warnings do not. The tree preserves sheet order so
 * siblings keep the order the author gave them.
 */
export function buildImport(
  rows: ImportRow[],
  mapping: ColumnMapping
): ImportParseResult {
  const issues: ImportIssue[] = [];

  if (!mapping.title) {
    issues.push({
      severity: "error",
      message: "Choose which column holds the position title before importing.",
    });
  }

  if (rows.length === 0) {
    issues.push({
      severity: "error",
      message: "The sheet has no position rows to import.",
    });
  }

  // Index by code, flagging duplicates. A blank code is allowed but cannot be
  // a parent, so it is not indexed.
  const byCode = new Map<string, ImportRow>();
  const duplicateCodes = new Set<string>();
  for (const row of rows) {
    if (!row.code) continue;
    if (byCode.has(row.code)) {
      duplicateCodes.add(row.code);
    } else {
      byCode.set(row.code, row);
    }
  }

  for (const code of duplicateCodes) {
    issues.push({
      severity: "error",
      code,
      message: `Code “${code}” is used by more than one position. Codes must be unique.`,
    });
  }

  for (const row of rows) {
    if (!row.title) {
      issues.push({
        severity: "error",
        rowNumber: row.rowNumber,
        code: row.code || undefined,
        message: `Row ${row.rowNumber} has no title.`,
      });
    }

    if (row.parentCode) {
      if (row.parentCode === row.code) {
        issues.push({
          severity: "error",
          rowNumber: row.rowNumber,
          code: row.code || undefined,
          message: `“${row.code}” reports to itself.`,
        });
      } else if (!byCode.has(row.parentCode)) {
        issues.push({
          severity: "error",
          rowNumber: row.rowNumber,
          code: row.code || undefined,
          message: `Row ${row.rowNumber} reports to “${row.parentCode}”, which is not in the sheet.`,
        });
      }
    }
  }

  // Cycle detection over the parent chain. Only runs on rows whose parent is
  // present, so it complements the missing-parent check above.
  const parentOf = (row: ImportRow): ImportRow | undefined =>
    row.parentCode ? byCode.get(row.parentCode) : undefined;

  const inCycle = new Set<string>();
  for (const row of rows) {
    if (!row.code || inCycle.has(row.code)) continue;
    const seen = new Set<string>();
    let current: ImportRow | undefined = row;
    while (current) {
      if (seen.has(current.code)) {
        // Everything on this walk is part of, or feeds into, a cycle.
        for (const code of seen) inCycle.add(code);
        break;
      }
      seen.add(current.code);
      const next: ImportRow | undefined = parentOf(current);
      if (next === current) break; // self-parent, already reported
      current = next;
    }
  }

  for (const code of inCycle) {
    issues.push({
      severity: "error",
      code,
      message: `“${code}” is part of a reporting loop. Reporting lines cannot form a circle.`,
    });
  }

  const roots = rows.filter(
    (row) => !row.parentCode || !byCode.has(row.parentCode)
  );

  if (rows.length > 0 && roots.length === 0) {
    issues.push({
      severity: "error",
      message: "Every position reports to another — there is no top of the chart.",
    });
  } else if (roots.length > 1) {
    issues.push({
      severity: "warning",
      message: `The chart has ${roots.length} top-level positions. That is allowed, but check it is intended.`,
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");

  // Build the tree only when nothing blocks it, so a partial/looping chart is
  // never half-created.
  let tree: PositionTreeInput[] = [];
  let maxDepth = 0;
  if (!hasErrors) {
    const childrenOf = new Map<string, ImportRow[]>();
    for (const row of rows) {
      const key = row.parentCode && byCode.has(row.parentCode) ? row.parentCode : "__root__";
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), row]);
    }

    const toNode = (row: ImportRow, depth: number): PositionTreeInput => {
      maxDepth = Math.max(maxDepth, depth);
      const kids = row.code ? (childrenOf.get(row.code) ?? []) : [];
      const node: PositionTreeInput = {
        title: row.title,
        ...(row.code ? { code: row.code } : {}),
        ...(row.role ? { role: row.role } : {}),
      };
      if (kids.length > 0) {
        node.children = kids.map((kid) => toNode(kid, depth + 1));
      }
      return node;
    };

    tree = (childrenOf.get("__root__") ?? []).map((row) => toNode(row, 1));
  }

  return {
    rows,
    issues,
    tree,
    stats: {
      total: rows.length,
      roots: roots.length,
      maxDepth,
    },
    canImport: !hasErrors && rows.length > 0,
  };
}
