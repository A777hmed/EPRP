"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { PositionTreeInput } from "@/services/organization-chart-service";
import {
  buildImport,
  guessColumnMapping,
  IMPORT_TEMPLATE_HEADERS,
  IMPORT_TEMPLATE_SAMPLE,
  mapRows,
  type ColumnMapping,
  type ImportField,
} from "../lib/organization-import";

type WizardStep = "upload" | "mapping" | "validation" | "preview";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "mapping", label: "Mapping" },
  { id: "validation", label: "Validation" },
  { id: "preview", label: "Preview & Import" },
];

const FIELD_LABELS: Record<ImportField, string> = {
  code: "Position Code",
  title: "Title",
  parentCode: "Parent Code",
  role: "Role",
};

const NONE_VALUE = "__none__";

export interface ImportWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Positions already on the chart; above zero, import replaces them. */
  existingPositionCount: number;
  importing: boolean;
  onImport: (
    tree: PositionTreeInput[],
    replaceExisting: boolean
  ) => Promise<void>;
}

/** Flatten the built tree to indented preview rows. */
function flattenTree(
  nodes: PositionTreeInput[],
  depth = 0
): { node: PositionTreeInput; depth: number; parent?: string }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenTree(node.children ?? [], depth + 1).map((row) => ({
      ...row,
      parent: row.parent ?? node.title,
    })),
  ]);
}

/**
 * Four-step Excel import: Upload → Mapping → Validation → Preview & Import.
 *
 * Parsing and validation live in {@link buildImport}; this component is the
 * wizard shell around it — read the file, let the author confirm which
 * columns are which, show what is wrong, then import what is right.
 */
export function ImportWizardDialog({
  open,
  onOpenChange,
  existingPositionCount,
  importing,
  onImport,
}: ImportWizardDialogProps) {
  const [step, setStep] = React.useState<WizardStep>("upload");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rawRows, setRawRows] = React.useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = React.useState<ColumnMapping>({
    code: null,
    title: null,
    parentCode: null,
    role: null,
  });
  const [readError, setReadError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const reset = React.useCallback(() => {
    setStep("upload");
    setFileName(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({ code: null, title: null, parentCode: null, role: null });
    setReadError(null);
    setDragging(false);
  }, []);

  const result = React.useMemo(
    () => buildImport(mapRows(rawRows, mapping), mapping),
    [rawRows, mapping]
  );

  const errorCount = result.issues.filter((i) => i.severity === "error").length;
  const warningCount = result.issues.filter(
    (i) => i.severity === "warning"
  ).length;
  const willReplace = existingPositionCount > 0;

  const handleDownloadTemplate = () => {
    const sheet = XLSX.utils.json_to_sheet(IMPORT_TEMPLATE_SAMPLE, {
      header: [...IMPORT_TEMPLATE_HEADERS],
    });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Positions");
    XLSX.writeFile(book, "organization-chart-template.xlsx");
  };

  const readFile = async (file: File) => {
    setReadError(null);
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      const firstSheet = book.SheetNames[0];
      if (!firstSheet) {
        setReadError("That file has no sheets.");
        return;
      }
      const sheet = book.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
      });
      const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        blankrows: false,
      })[0];
      const columns = (headerRow ?? []).map((h) => String(h).trim()).filter(Boolean);

      if (columns.length === 0) {
        setReadError("The first row must be column headers.");
        return;
      }

      setFileName(file.name);
      setHeaders(columns);
      setRawRows(rows);
      setMapping(guessColumnMapping(columns));
      setStep("mapping");
    } catch {
      setReadError(
        "Could not read that file. Export it as .xlsx or .csv and try again."
      );
    }
  };

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the input so re-picking the same file fires change again.
    event.target.value = "";
    if (file) void readFile(file);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  };

  const setField = (field: ImportField, value: string) =>
    setMapping((previous) => ({
      ...previous,
      [field]: value === NONE_VALUE ? null : value,
    }));

  const handleImport = async () => {
    await onImport(result.tree, willReplace);
    reset();
  };

  const previewRows = flattenTree(result.tree);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import from Excel</DialogTitle>
          <DialogDescription>
            Bring in a chart from a spreadsheet. Each row is a position; the
            Parent Code column sets who it reports to.
          </DialogDescription>
        </DialogHeader>

        {/* ------------------------------ Stepper ------------------------- */}
        <ol className="flex items-center gap-1 text-xs">
          {STEPS.map((entry, index) => {
            const current = entry.id === step;
            const done = STEPS.findIndex((s) => s.id === step) > index;
            return (
              <li key={entry.id} className="flex items-center gap-1">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[0.7rem] font-semibold",
                    current && "border-primary bg-primary text-primary-foreground",
                    done && "border-success bg-success/15 text-success",
                    !current && !done && "border-border text-muted-foreground"
                  )}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span
                  className={cn(
                    "font-medium",
                    current ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {entry.label}
                </span>
                {index < STEPS.length - 1 && (
                  <span aria-hidden="true" className="mx-1 text-muted-foreground">
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <Separator />

        {/* ---------------------------- Step body ------------------------- */}
        <div className="min-h-56">
          {step === "upload" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Need the format?</p>
                  <p className="text-xs text-muted-foreground text-pretty">
                    Download a template with the expected columns and a few
                    example rows.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                  <Download data-icon="inline-start" aria-hidden="true" />
                  Template
                </Button>
              </div>

              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">
                  Drag a spreadsheet here, or click to choose
                </span>
                <span className="text-xs text-muted-foreground">
                  .xlsx, .xls or .csv
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={onFileInput}
                />
              </label>

              {readError && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {readError}
                </p>
              )}
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileSpreadsheet className="size-3.5" aria-hidden="true" />
                {fileName} · {rawRows.length} row
                {rawRows.length === 1 ? "" : "s"}
              </p>
              <p className="text-sm text-pretty">
                Match your columns to the fields below. Title is required;
                Parent Code sets the hierarchy.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(FIELD_LABELS) as ImportField[]).map((field) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-medium">
                      {FIELD_LABELS[field]}
                      {field === "title" && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </label>
                    <Select
                      value={mapping[field] ?? NONE_VALUE}
                      onValueChange={(value) => setField(field, value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Not mapped" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>Not mapped</SelectItem>
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "validation" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="info">{result.stats.total} positions</StatusBadge>
                <StatusBadge tone="neutral">
                  {result.stats.roots} top-level
                </StatusBadge>
                {result.stats.maxDepth > 0 && (
                  <StatusBadge tone="neutral">
                    {result.stats.maxDepth} levels
                  </StatusBadge>
                )}
                <StatusBadge tone={errorCount > 0 ? "danger" : "success"}>
                  {errorCount} error{errorCount === 1 ? "" : "s"}
                </StatusBadge>
                {warningCount > 0 && (
                  <StatusBadge tone="warning">
                    {warningCount} warning{warningCount === 1 ? "" : "s"}
                  </StatusBadge>
                )}
              </div>

              {result.issues.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                  <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
                  <p className="text-sm font-medium">Everything checks out</p>
                  <p className="text-xs text-muted-foreground">
                    No problems found. Continue to preview the chart.
                  </p>
                </div>
              ) : (
                <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {result.issues.map((issue, index) => (
                    <li
                      key={index}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2 text-xs",
                        issue.severity === "error"
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-warning/30 bg-warning/5"
                      )}
                    >
                      <AlertTriangle
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          issue.severity === "error"
                            ? "text-destructive"
                            : "text-warning"
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-pretty">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {errorCount > 0 && (
                <p className="text-xs text-muted-foreground text-pretty">
                  Fix the errors in your spreadsheet and upload it again. The
                  chart cannot be imported while errors remain.
                </p>
              )}
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              {willReplace && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-pretty">
                    This chart already has {existingPositionCount} position
                    {existingPositionCount === 1 ? "" : "s"}. Importing archives
                    them and replaces the structure. Assignment history is kept.
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {previewRows.length} position
                {previewRows.length === 1 ? "" : "s"} will be created, vacant.
              </p>
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Reports to</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map(({ node, depth, parent }) => (
                      <TableRow key={`${node.code ?? ""}-${node.title}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {node.code ?? "—"}
                        </TableCell>
                        <TableCell style={{ paddingLeft: 12 + depth * 16 }}>
                          <span className={cn(depth === 0 && "font-semibold")}>
                            {node.title}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {parent ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {node.role ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* ------------------------------ Footer -------------------------- */}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {step !== "upload" && (
              <Button
                variant="outline"
                onClick={() => {
                  const index = STEPS.findIndex((s) => s.id === step);
                  setStep(STEPS[index - 1].id);
                }}
                disabled={importing}
              >
                Back
              </Button>
            )}

            {step === "mapping" && (
              <Button
                onClick={() => setStep("validation")}
                disabled={!mapping.title}
                title={mapping.title ? undefined : "Map the Title column first"}
              >
                Validate
              </Button>
            )}

            {step === "validation" && (
              <Button
                onClick={() => setStep("preview")}
                disabled={!result.canImport}
              >
                Preview
              </Button>
            )}

            {step === "preview" && (
              <Button
                onClick={() => void handleImport().catch(() => {})}
                disabled={importing || !result.canImport}
              >
                {importing && (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {willReplace ? "Replace with import" : "Import chart"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
