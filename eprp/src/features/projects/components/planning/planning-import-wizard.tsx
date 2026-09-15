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
import { Checkbox } from "@/components/ui/checkbox";
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
import { planningService } from "@/services/planning-service";
import type { PlanningImportSourceFormat } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  detectDataDate,
  EPRP_TEMPLATE_HEADERS,
  EPRP_TEMPLATE_SAMPLE,
  guessColumnMapping,
  parseImportRows,
  PLANNING_IMPORT_FIELDS,
  validateImportRows,
  type ColumnMapping,
  type PlanningImportField,
} from "../../lib/planning-import";

type WizardStep = "source" | "upload" | "mapping" | "validate" | "preview";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "upload", label: "Upload" },
  { id: "mapping", label: "Mapping" },
  { id: "validate", label: "Validate" },
  { id: "preview", label: "Preview & Save" },
];

const SOURCE_LABEL: Record<PlanningImportSourceFormat, string> = {
  eprp_excel: "EPRP Excel Template",
  p6: "Primavera P6 (Excel/CSV export)",
  msproject: "MS Project (Excel/CSV export)",
};

const NONE_VALUE = "__none__";

export interface PlanningImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Master Plan codes already on record, for the broken-parent-reference check. */
  existingWorkItemCodes: string[];
  onSaved: () => void;
}

/**
 * Upload → choose/detect source → parse → auto-suggest mapping → user
 * confirms mapping → validate → preview → save Draft Import Batch.
 *
 * Never publishes automatically — the last action here is
 * `planningService.saveImportRows`, which only writes
 * planning_import_batches/planning_import_rows. Promoting a row into the
 * live Master Plan happens later, in Planning Review.
 */
export function PlanningImportWizard({
  open,
  onOpenChange,
  projectId,
  existingWorkItemCodes,
  onSaved,
}: PlanningImportWizardProps) {
  const [step, setStep] = React.useState<WizardStep>("source");
  const [sourceType, setSourceType] = React.useState<PlanningImportSourceFormat>("eprp_excel");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rawRows, setRawRows] = React.useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [mappingConfirmed, setMappingConfirmed] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dataDate, setDataDate] = React.useState("");
  const [dataDateDetected, setDataDateDetected] = React.useState(false);

  const reset = React.useCallback(() => {
    setStep("source");
    setSourceType("eprp_excel");
    setFileName(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setMappingConfirmed(false);
    setReadError(null);
    setDragging(false);
    setDataDate("");
    setDataDateDetected(false);
  }, []);

  const existingCodes = React.useMemo(
    () => new Set(existingWorkItemCodes),
    [existingWorkItemCodes]
  );

  const parsed = React.useMemo(
    () => parseImportRows(rawRows, mapping),
    [rawRows, mapping]
  );
  const result = React.useMemo(
    () => validateImportRows(parsed, existingCodes),
    [parsed, existingCodes]
  );

  const errorCount = result.issues.filter((i) => i.severity === "error").length;
  const warningCount = result.issues.filter((i) => i.severity === "warning").length;
  const deterministic = sourceType === "eprp_excel";

  const handleDownloadTemplate = () => {
    const sheet = XLSX.utils.json_to_sheet([EPRP_TEMPLATE_SAMPLE], {
      header: [...EPRP_TEMPLATE_HEADERS],
    });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Planning");
    XLSX.writeFile(book, "eprp-planning-template.xlsx");
  };

  const readFile = async (file: File) => {
    setReadError(null);
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheet = book.SheetNames[0];
      if (!firstSheet) {
        setReadError("That file has no sheets.");
        return;
      }
      const sheet = book.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        blankrows: false,
      })[0];
      const columns = (headerRow ?? []).map((h) => String(h).trim()).filter(Boolean);

      if (columns.length === 0) {
        setReadError("The first row must be column headers.");
        return;
      }
      if (rows.length === 0) {
        setReadError("That file has headers but no data rows.");
        return;
      }

      setFileName(file.name);
      setHeaders(columns);
      setRawRows(rows);
      setMapping(guessColumnMapping(columns, sourceType));
      setMappingConfirmed(false);

      const detected = detectDataDate(columns, rows);
      setDataDate(detected ?? "");
      setDataDateDetected(Boolean(detected));

      setStep("mapping");
    } catch {
      setReadError("Could not read that file. Export it as .xlsx or .csv and try again.");
    }
  };

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void readFile(file);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  };

  const setField = (field: PlanningImportField, value: string) =>
    setMapping((previous) => ({ ...previous, [field]: value === NONE_VALUE ? null : value }));

  const mappingValid = Boolean(mapping.activityId && mapping.activityName);
  const canLeaveMapping = mappingValid && (deterministic || mappingConfirmed);

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const batch = await planningService.createImportBatch({
        projectId,
        sourceType,
        fileName: fileName ?? undefined,
        dataDate,
      });
      await planningService.saveImportRows(
        batch.id,
        result.rows.map((row) => ({
          rowNumber: row.rowNumber,
          externalId: row.activityId,
          wbsPath: row.wbsParent,
          name: row.activityName,
          rawData: { ...row.rawData, activityType: row.activityType, isMilestone: row.isMilestone },
          parseStatus: result.issues.some((i) => i.rowNumber === row.rowNumber && i.severity === "error")
            ? "error"
            : result.issues.some((i) => i.rowNumber === row.rowNumber && i.severity === "warning")
              ? "warning"
              : "ok",
        }))
      );
      onSaved();
      reset();
    } catch {
      // planningService already surfaces a toast-worthy Error; the caller's
      // onSaved/UI shows it. Keep the wizard open so nothing is lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Planning Data</DialogTitle>
          <DialogDescription>
            Upload a schedule export. Nothing is published — this saves a
            Draft Import Batch for Planning Review to confirm.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-1 text-xs">
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
                <span className={cn("font-medium", current ? "text-foreground" : "text-muted-foreground")}>
                  {entry.label}
                </span>
                {index < STEPS.length - 1 && (
                  <span aria-hidden="true" className="mx-1 text-muted-foreground">→</span>
                )}
              </li>
            );
          })}
        </ol>

        <Separator />

        <div className="min-h-64">
          {step === "source" && (
            <div className="space-y-3">
              <p className="text-sm text-pretty">
                Choose the format you are importing. Native P6 XER and native
                MS Project (.mpp) files are not supported — export to Excel
                or CSV first.
              </p>
              <div className="grid gap-2">
                {(Object.keys(SOURCE_LABEL) as PlanningImportSourceFormat[]).map((source) => (
                  <label
                    key={source}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm transition-colors",
                      sourceType === source ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <span>
                      <span className="font-medium">{SOURCE_LABEL[source]}</span>
                      {source === "eprp_excel" && (
                        <span className="block text-xs text-muted-foreground">
                          Deterministic column mapping — no confirmation step needed.
                        </span>
                      )}
                      {source !== "eprp_excel" && (
                        <span className="block text-xs text-muted-foreground">
                          Best-effort column detection — you confirm the mapping.
                        </span>
                      )}
                    </span>
                    <input
                      type="radio"
                      name="planning-source"
                      className="size-4"
                      checked={sourceType === source}
                      onChange={() => setSourceType(source)}
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Manual entry needs no import — add work items directly from
                the Master Plan tab.
              </p>
            </div>
          )}

          {step === "upload" && (
            <div className="space-y-3">
              {deterministic && (
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3">
                  <div>
                    <p className="text-sm font-medium">Need the format?</p>
                    <p className="text-xs text-muted-foreground text-pretty">
                      Download the EPRP Planning Template with the expected
                      columns and one example row.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                    <Download data-icon="inline-start" aria-hidden="true" />
                    Template
                  </Button>
                </div>
              )}

              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                )}
              >
                <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">Drag a spreadsheet here, or click to choose</span>
                <span className="text-xs text-muted-foreground">.xlsx, .xls or .csv</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onFileInput} />
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
                {fileName} · {rawRows.length} row{rawRows.length === 1 ? "" : "s"}
              </p>
              <p className="text-sm text-pretty">
                Match your columns to the fields below. Activity ID and
                Activity Name are required; everything else stays blank if
                not mapped — nothing is guessed at.
              </p>
              <div className="grid max-h-80 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {PLANNING_IMPORT_FIELDS.map(({ field, label, required }) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-medium">
                      {label}
                      {required && <span className="ml-1 text-destructive">*</span>}
                    </label>
                    <Select
                      value={mapping[field] ?? NONE_VALUE}
                      onValueChange={(value) => setField(field, value)}
                      disabled={deterministic}
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
              {!deterministic && (
                <label className="flex items-start gap-2 rounded-lg border p-3 text-xs">
                  <Checkbox
                    checked={mappingConfirmed}
                    onCheckedChange={(checked) => setMappingConfirmed(checked === true)}
                  />
                  <span className="text-pretty">
                    I have reviewed this best-effort column mapping and
                    confirm it is correct for this file.
                  </span>
                </label>
              )}
            </div>
          )}

          {step === "validate" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="info">{result.stats.total} rows</StatusBadge>
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
                    No problems found. Continue to preview and save.
                  </p>
                </div>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
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
                          issue.severity === "error" ? "text-destructive" : "text-warning"
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
                  Fix the errors in your file and upload it again. A batch
                  with blocking errors cannot be saved.
                </p>
              )}
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {result.rows.length} row{result.rows.length === 1 ? "" : "s"} will
                be saved as a Draft Import Batch. Nothing is published or
                added to the Master Plan yet — Planning Review confirms each
                row from here.
              </p>

              <div className="grid gap-1.5 rounded-lg border p-3">
                <Label htmlFor="import-data-date">
                  Data Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="import-data-date"
                  type="date"
                  value={dataDate}
                  onChange={(event) => {
                    setDataDate(event.target.value);
                    setDataDateDetected(false);
                  }}
                  className="max-w-48"
                />
                <p className="text-xs text-muted-foreground text-pretty">
                  {dataDateDetected
                    ? "Detected from a Data Date / Status Date column in the file — confirm or change it."
                    : "The schedule's own Data Date / Status Date, not today's date. Required before this batch can be published — it was not found in the file, so enter it from your schedule."}
                </p>
              </div>

              <div className="max-h-72 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>WBS/Parent</TableHead>
                      <TableHead>Current Start</TableHead>
                      <TableHead>Current Finish</TableHead>
                      <TableHead>Planned %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.slice(0, 200).map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell className="font-mono text-xs">{row.activityId}</TableCell>
                        <TableCell className="text-xs">{row.activityName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.wbsParent ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.currentStart ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.currentFinish ?? "—"}</TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {row.plannedPercent ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {result.rows.length > 200 && (
                <p className="text-xs text-muted-foreground">
                  Showing the first 200 of {result.rows.length} rows.
                </p>
              )}
            </div>
          )}
        </div>

        <Separator />

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            <X data-icon="inline-start" aria-hidden="true" />
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {step !== "source" && (
              <Button
                variant="outline"
                onClick={() => setStep(STEPS[STEPS.findIndex((s) => s.id === step) - 1].id)}
                disabled={saving}
              >
                Back
              </Button>
            )}

            {step === "source" && <Button onClick={() => setStep("upload")}>Continue</Button>}

            {step === "mapping" && (
              <Button
                onClick={() => setStep("validate")}
                disabled={!canLeaveMapping}
                title={!mappingValid ? "Map Activity ID and Activity Name first" : undefined}
              >
                Validate
              </Button>
            )}

            {step === "validate" && (
              <Button onClick={() => setStep("preview")} disabled={!result.canImport}>
                Preview
              </Button>
            )}

            {step === "preview" && (
              <Button
                onClick={() => void handleSaveDraft()}
                disabled={saving || !result.canImport || !dataDate}
                title={!dataDate ? "Enter the schedule's Data Date first" : undefined}
              >
                {saving && (
                  <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                )}
                Save Draft Import Batch
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
