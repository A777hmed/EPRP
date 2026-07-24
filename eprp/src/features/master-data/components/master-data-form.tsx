"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { MasterRecordBase } from "@/types";
import { getMasterService, MASTER_KIND_CONFIG } from "../services";
import {
  DuplicateRecordError,
  type MasterFieldConfig,
  type MasterKind,
} from "../types";
import { useMasterData } from "../use-master-data";

/* ------------------------------ Validation -------------------------------- */

/** Build a Zod schema from a kind's field config (form values are strings). */
function buildSchema(fields: MasterFieldConfig[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = z.string().superRefine((raw, ctx) => {
      const value = raw.trim();
      if (field.required && !value) {
        ctx.addIssue({ code: "custom", message: `${field.label} is required` });
        return;
      }
      if (!value) return;
      if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address" });
      }
      if (field.type === "number" && Number.isNaN(Number(value))) {
        ctx.addIssue({ code: "custom", message: "Enter a number" });
      }
    });
  }
  return z.object(shape);
}

/* --------------------------- Reference select ----------------------------- */

function ReferenceSelect({
  refKind,
  value,
  onChange,
  required,
  controlProps,
}: {
  refKind: MasterKind;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  controlProps: Record<string, unknown>;
}) {
  const { records, activeRecords } = useMasterData(refKind);
  const config = MASTER_KIND_CONFIG[refKind];
  const selected = records.find((r) => r.id === value);
  // Show active options plus the current value even if archived.
  const options =
    selected && !selected.active ? [selected, ...activeRecords] : activeRecords;

  return (
    <Select
      value={value || (required ? undefined : "__none__")}
      onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
    >
      <SelectTrigger {...controlProps} className="w-full">
        <SelectValue placeholder={`Select ${config.singular.toLowerCase()}…`} />
      </SelectTrigger>
      <SelectContent>
        {!required && <SelectItem value="__none__">Not assigned</SelectItem>}
        {options.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
            {!r.active ? " (archived)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------- Form ------------------------------------ */

export interface MasterDataFormProps {
  kind: MasterKind;
  /** Editing an existing record, or undefined for create. */
  record?: MasterRecordBase;
  /** Prefill the name field in create mode (e.g. from a search box). */
  initialName?: string;
  /**
   * Prefill other fields in create mode, keyed by field key. Used when a
   * record is created from a related page — a contact added from a
   * department arrives with that department already set.
   */
  presetValues?: Record<string, string>;
  onSaved: (
    record: MasterRecordBase,
    mode: "create" | "edit",
    /** Which save action was used, when several are offered. */
    actionId?: string
  ) => void;
  onCancel: () => void;
  /** Layout: single column (page) or two (dialog). */
  columns?: 1 | 2;
  /** Overrides the single submit label, e.g. "Save & Return to Project". */
  submitLabel?: string;
  /**
   * Several save buttons instead of one. The last is rendered as the primary
   * action; the rest as outlines. Used by the project flow to offer
   * "Save & Add Another", "Save & Continue", and "Save & Return to Project".
   */
  saveActions?: { id: string; label: string }[];
}

/**
 * Field-driven create/edit form for any master-data kind. Renders text,
 * email, tel, number, textarea, and reference (managed relationship)
 * fields from the kind's config, validates with Zod, and surfaces
 * duplicate name/code errors from the service.
 */
export function MasterDataForm({
  kind,
  record,
  initialName,
  presetValues,
  onSaved,
  onCancel,
  columns = 2,
  submitLabel,
  saveActions,
}: MasterDataFormProps) {
  const config = MASTER_KIND_CONFIG[kind];
  const service = getMasterService(kind);
  const isEdit = record !== undefined;
  const schema = React.useMemo(() => buildSchema(config.fields), [config.fields]);
  const formId = React.useId();

  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of config.fields) {
      const raw = record
        ? (record as unknown as Record<string, unknown>)[field.key]
        : field.key === "name"
          ? initialName
          : presetValues?.[field.key];
      initial[field.key] = raw === undefined || raw === null ? "" : String(raw);
    }
    return initial;
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = async (actionId?: string) => {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});

    const input: Record<string, unknown> = {};
    for (const field of config.fields) {
      const value = values[field.key]?.trim() ?? "";
      input[field.key] =
        field.type === "number"
          ? value === ""
            ? undefined
            : Number(value)
          : value || undefined;
    }

    try {
      setSaving(true);
      const saved = isEdit
        ? await service.update(record.id, input)
        : await service.create(
            input as Partial<MasterRecordBase> & { name: string }
          );
      onSaved(saved, isEdit ? "edit" : "create", actionId);
    } catch (error) {
      if (error instanceof DuplicateRecordError) {
        setErrors((prev) => ({ ...prev, [error.field]: error.message }));
      } else {
        toast.error("Could not save the record");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={cn("grid gap-3", columns === 2 && "sm:grid-cols-2")}
      >
        {config.fields.map((field) => {
          const id = `${formId}-${field.key}`;
          const error = errors[field.key];
          const describedBy = error ? `${id}-error` : undefined;
          const controlProps = {
            id,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": describedBy,
            "aria-required": field.required || undefined,
          };
          return (
            <Field
              key={field.key}
              data-invalid={error ? true : undefined}
              className={
                field.type === "textarea" && columns === 2
                  ? "sm:col-span-2"
                  : undefined
              }
            >
              <FieldLabel htmlFor={id}>
                {field.label}
                {field.required && (
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                )}
              </FieldLabel>
              {field.type === "reference" && field.refKind ? (
                <ReferenceSelect
                  refKind={field.refKind}
                  value={values[field.key] ?? ""}
                  onChange={(v) => setValue(field.key, v)}
                  required={field.required}
                  controlProps={controlProps}
                />
              ) : field.type === "textarea" ? (
                <Textarea
                  {...controlProps}
                  rows={2}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValue(field.key, e.target.value)}
                />
              ) : (
                <Input
                  {...controlProps}
                  type={field.type === "number" ? "number" : field.type}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValue(field.key, e.target.value)}
                />
              )}
              {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
            </Field>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {saveActions && saveActions.length > 0 ? (
          saveActions.map((action, index) => (
            <Button
              key={action.id}
              variant={
                index === saveActions.length - 1 ? "default" : "outline"
              }
              onClick={() => handleSave(action.id)}
              disabled={saving}
            >
              {saving && (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {action.label}
            </Button>
          ))
        ) : (
          <Button onClick={() => handleSave()} disabled={saving}>
            {saving && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {submitLabel ??
              (isEdit ? "Save Changes" : `Add ${config.singular}`)}
          </Button>
        )}
      </div>
    </div>
  );
}
