"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface AddPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the parent position, or undefined when adding a root. */
  parentTitle?: string;
  onSubmit: (title: string) => Promise<void>;
}

/**
 * Minimal create dialog: a title is the least a position needs to exist.
 *
 * Department, discipline, people, and notes are deliberately absent — those
 * belong to the editing panel, which is a later step.
 */
export function AddPositionDialog({
  open,
  onOpenChange,
  parentTitle,
  onSubmit,
}: AddPositionDialogProps) {
  const [title, setTitle] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const inputId = React.useId();

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Position title is required");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(trimmed);
      setTitle("");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTitle("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {parentTitle ? "Add position" : "Add root position"}
          </DialogTitle>
          <DialogDescription>
            {parentTitle
              ? `Reports to ${parentTitle}.`
              : "The top of the reporting structure for this project."}
          </DialogDescription>
        </DialogHeader>

        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={inputId}>
            Position title
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </FieldLabel>
          <Input
            id={inputId}
            value={title}
            autoFocus
            placeholder="e.g. Project Manager"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            Add position
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
