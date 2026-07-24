"use client";

import * as React from "react";
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

export interface RhfFieldRenderProps<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> {
  field: ControllerRenderProps<TValues, TName>;
  /** Spread onto the control: id + aria error/required wiring. */
  controlProps: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
    "aria-required": boolean | undefined;
  };
}

export interface RhfFieldProps<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> {
  control: Control<TValues>;
  name: TName;
  label: string;
  /** Mandatory for final submission: red asterisk + aria-required. */
  required?: boolean;
  /** Show a muted "Optional" marker beside the label. */
  optional?: boolean;
  description?: string;
  className?: string;
  children: (props: RhfFieldRenderProps<TValues, TName>) => React.ReactNode;
}

/**
 * React Hook Form field wrapper: label (with required asterisk or Optional
 * marker), control, description, and error — errors are linked via
 * aria-describedby and announced through role="alert". The wrapper carries
 * data-field-name so the error summary can scroll to and focus the field.
 */
export function RhfField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  label,
  required = false,
  optional = false,
  description,
  className,
  children,
}: RhfFieldProps<TValues, TName>) {
  const id = React.useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const invalid = fieldState.invalid;
        const describedBy =
          [invalid ? errorId : null, description ? descriptionId : null]
            .filter(Boolean)
            .join(" ") || undefined;

        return (
          <Field
            className={cn(className)}
            data-invalid={invalid || undefined}
            data-field-name={name}
          >
            <FieldLabel htmlFor={id}>
              {label}
              {required && (
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              )}
              {optional && !required && (
                <span className="text-xs font-normal text-muted-foreground">
                  Optional
                </span>
              )}
            </FieldLabel>
            {children({
              field,
              controlProps: {
                id,
                "aria-invalid": invalid || undefined,
                "aria-describedby": describedBy,
                "aria-required": required || undefined,
              },
            })}
            {description && (
              <FieldDescription id={descriptionId}>
                {description}
              </FieldDescription>
            )}
            {invalid && (
              <FieldError id={errorId}>{fieldState.error?.message}</FieldError>
            )}
          </Field>
        );
      }}
    />
  );
}
