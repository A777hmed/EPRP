"use client";

import * as React from "react";
import { ImageIcon, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Controller, type Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { ProgressBar } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { ProjectFormValues } from "@/features/projects/schemas/project-form";

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
] as const;
const ACCEPT_ATTR = ".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml";
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface LogoUploadFieldProps {
  control: Control<ProjectFormValues>;
  name: "projectLogoRef" | "clientLogoRef";
  label: string;
}

/**
 * Mock logo upload (Phase 5A): click or drag-and-drop, type/size
 * validation, simulated progress, preview with replace/remove. The image
 * is stored as a data URL in local form state — Supabase Storage replaces
 * this in a later phase.
 */
export function LogoUploadField({ control, name, label }: LogoUploadFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const progressTimer = React.useRef<number | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const errorId = `${id}-error`;

  React.useEffect(() => {
    return () => {
      if (progressTimer.current !== null) {
        window.clearInterval(progressTimer.current);
      }
    };
  }, []);

  const processFile = (file: File, onDone: (dataUrl: string) => void) => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
      setError("Unsupported file type — use PNG, JPG, JPEG, or SVG");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("File is larger than 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      // Simulated upload progress until real storage exists.
      setProgress(0);
      let value = 0;
      progressTimer.current = window.setInterval(() => {
        value += 20;
        if (value >= 100) {
          if (progressTimer.current !== null) {
            window.clearInterval(progressTimer.current);
            progressTimer.current = null;
          }
          setProgress(null);
          onDone(dataUrl);
        } else {
          setProgress(value);
        }
      }, 120);
    };
    reader.onerror = () => setError("The file could not be read");
    reader.readAsDataURL(file);
  };

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const value = typeof field.value === "string" ? field.value : "";
        const setValue = (next: string) => field.onChange(next);

        return (
          <div className="space-y-1.5" data-field-name={name}>
            <p className="flex items-center gap-2 text-sm font-medium">
              {label}
              <span className="text-xs font-normal text-muted-foreground">
                Optional
              </span>
            </p>

            {progress !== null ? (
              <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6">
                <ProgressBar
                  value={progress}
                  ariaLabel={`Uploading ${label}`}
                  size="sm"
                  className="max-w-48"
                />
                <p className="text-xs text-muted-foreground">Uploading…</p>
              </div>
            ) : value ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                {/* Data-URL preview from mock upload — next/image adds nothing here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={value}
                  alt={`${label} preview`}
                  className="h-16 w-24 shrink-0 rounded-md bg-white object-contain ring-1 ring-foreground/10"
                />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                  >
                    <RefreshCw data-icon="inline-start" aria-hidden="true" />
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setValue("");
                      setError(null);
                    }}
                  >
                    <Trash2 data-icon="inline-start" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Upload ${label}: PNG, JPG, JPEG, or SVG up to 2 MB`}
                aria-describedby={error ? errorId : undefined}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) processFile(file, setValue);
                }}
                className={cn(
                  "flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors outline-none",
                  "hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  dragOver && "border-primary bg-primary/5 text-primary"
                )}
              >
                {dragOver ? (
                  <UploadCloud className="size-5" aria-hidden="true" />
                ) : (
                  <ImageIcon className="size-5" aria-hidden="true" />
                )}
                <p className="text-xs">
                  Click to upload or drag &amp; drop
                </p>
                <p className="text-[10px]">PNG, JPG, JPEG, SVG · max 2 MB</p>
              </button>
            )}

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processFile(file, setValue);
                e.target.value = "";
              }}
            />

            {error && <FieldError id={errorId}>{error}</FieldError>}
          </div>
        );
      }}
    />
  );
}
