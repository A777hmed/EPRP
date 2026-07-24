"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, Network } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  chartTemplates,
  countTemplateNodes,
  flattenTemplate,
  templateDepth,
  type ChartTemplate,
} from "../lib/chart-templates";

export interface TemplateSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * How many positions the chart already has. Above zero, loading a template
   * replaces them, so the dialog asks first.
   */
  existingPositionCount: number;
  applying: boolean;
  onApply: (template: ChartTemplate) => Promise<void>;
}

/**
 * Template picker: a list of structures on the left, a preview of the
 * selected one on the right.
 *
 * Loading into a chart that already has positions replaces them, so that
 * path goes through an explicit confirmation rather than a single click.
 */
export function TemplateSelectorDialog({
  open,
  onOpenChange,
  existingPositionCount,
  applying,
  onApply,
}: TemplateSelectorDialogProps) {
  const [selectedId, setSelectedId] = React.useState<string>(
    chartTemplates[0].id
  );
  const [confirming, setConfirming] = React.useState(false);

  const selected =
    chartTemplates.find((template) => template.id === selectedId) ??
    chartTemplates[0];

  const willReplace = existingPositionCount > 0;
  const rows = flattenTemplate(selected.nodes);

  const reset = () => {
    setConfirming(false);
    setSelectedId(chartTemplates[0].id);
  };

  const handlePrimary = async () => {
    // Anything already on the chart is about to be replaced — ask first.
    if (willReplace && !confirming) {
      setConfirming(true);
      return;
    }
    await onApply(selected);
    reset();
  };

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
          <DialogTitle>Load a template</DialogTitle>
          <DialogDescription>
            Start from a standard structure. Positions are created vacant, and
            everything stays editable afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
          {/* ------------------------- Template cards ---------------------- */}
          <div
            role="radiogroup"
            aria-label="Templates"
            className="flex max-h-72 flex-col gap-2 overflow-y-auto md:max-h-none"
          >
            {chartTemplates.map((template) => {
              const active = template.id === selected.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelectedId(template.id);
                    // Changing template invalidates a pending confirmation.
                    setConfirming(false);
                  }}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    "hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active && "border-primary bg-primary/5 ring-1 ring-primary/30"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {template.name}
                    </span>
                    {active && (
                      <Check
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">
                    {template.description}
                  </span>
                </button>
              );
            })}
          </div>

          {/* -------------------------- Preview panel ---------------------- */}
          <section
            aria-label={`${selected.name} preview`}
            className="rounded-lg border bg-muted/20 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{selected.name}</h3>
              <div className="flex items-center gap-1.5">
                <StatusBadge tone="info">
                  {countTemplateNodes(selected.nodes)} positions
                </StatusBadge>
                <StatusBadge tone="neutral">
                  {templateDepth(selected.nodes)} levels
                </StatusBadge>
              </div>
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground text-pretty">
              {selected.details}
            </p>

            {selected.suitedTo.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {selected.suitedTo.map((item) => (
                  <li
                    key={item}
                    className="rounded-md bg-muted px-2 py-0.5 text-[0.7rem] text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}

            <Separator className="my-3" />

            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                <Network
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-xs text-muted-foreground">
                  No positions — you will start from an empty canvas.
                </p>
              </div>
            ) : (
              <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                {rows.map(({ node, depth }) => (
                  <li
                    key={`${node.code}-${node.title}`}
                    style={{ paddingLeft: depth * 14 }}
                    className="flex items-baseline gap-2 text-xs"
                  >
                    <span className="font-mono text-[0.7rem] text-muted-foreground">
                      {node.code}
                    </span>
                    <span className={cn(depth === 0 && "font-semibold")}>
                      {node.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* --------------------- Overwrite confirmation ------------------- */}
        {confirming && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <p className="text-xs text-pretty">
              This chart already has {existingPositionCount} position
              {existingPositionCount === 1 ? "" : "s"}. Loading{" "}
              <strong>{selected.name}</strong> archives them and replaces the
              structure. Assignment history is kept.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            Cancel
          </Button>
          {confirming && (
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={applying}
            >
              Back
            </Button>
          )}
          <Button
            onClick={handlePrimary}
            disabled={applying}
            variant={confirming ? "destructive" : "default"}
          >
            {applying && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {confirming
              ? "Replace chart"
              : willReplace
                ? "Load template…"
                : `Load ${selected.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
