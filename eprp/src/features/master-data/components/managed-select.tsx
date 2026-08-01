"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearValueButton } from "@/components/shared/clear-value-button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MasterRecordBase } from "@/types";
import { MASTER_KIND_CONFIG } from "../services";
import type { MasterKind } from "../types";
import { useMasterData } from "../use-master-data";
import { MasterDataDialog } from "./master-data-dialog";

export interface ManagedSelectProps {
  kind: MasterKind;
  /** Selected record id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Offer a "Not assigned" entry inside the list for optional fields. */
  allowClear?: boolean;
  /**
   * Accessible name for the "×" button, e.g. "Clear Project Manager".
   * Defaults to the master-data kind when the field has no distinct name.
   */
  clearLabel?: string;
  /** ARIA wiring from the form field wrapper. */
  controlProps?: {
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    "aria-required"?: boolean;
  };
  /** Fires after any master-data mutation (for unsaved-changes tracking). */
  onMutated?: () => void;
  /**
   * Narrow the selectable options, e.g. disciplines belonging to the chosen
   * department. The current selection is always kept visible.
   */
  filter?: (record: MasterRecordBase) => boolean;
  /** Message shown when the filter leaves no options. */
  emptyLabel?: string;
  /** Hide a selected record when it no longer matches `filter`. */
  enforceFilter?: boolean;
  disabled?: boolean;
}

/**
 * Searchable select over an admin-managed master-data kind, with inline
 * "+ Add new" creation (auto-selected afterwards) and a Manage surface
 * for edit / archive / restore / safe delete. Options refresh
 * automatically whenever the kind's store changes.
 *
 * Whenever a value is assigned — required field or not — a "×" appears that
 * unassigns it in this form only. Master data is untouched; archiving and
 * deleting stay behind the Manage surface. Required fields may sit empty
 * while drafting; their schema still blocks final submission.
 */
export function ManagedSelect({
  kind,
  value,
  onChange,
  onBlur,
  placeholder,
  allowClear = false,
  clearLabel,
  controlProps,
  onMutated,
  filter,
  emptyLabel,
  enforceFilter = false,
  disabled = false,
}: ManagedSelectProps) {
  const config = MASTER_KIND_CONFIG[kind];
  const { records, activeRecords } = useMasterData(kind);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    mode: "list" | "create";
    initialName?: string;
  }>({ open: false, mode: "list" });

  const selected = records.find((r) => r.id === value);

  // Active options, plus the current selection even when archived so
  // historical projects keep displaying their stored value.
  const options: MasterRecordBase[] = React.useMemo(() => {
    const available = filter ? activeRecords.filter(filter) : activeRecords;
    // Keep the current selection visible even when archived or filtered out.
    if (
      selected &&
      !enforceFilter &&
      !available.some((record) => record.id === selected.id)
    ) {
      return [selected, ...available];
    }
    return available;
  }, [activeRecords, selected, filter, enforceFilter]);

  const selectedAllowed =
    selected && (!filter || !enforceFilter || filter(selected));
  const triggerLabel = selectedAllowed
    ? `${selected.name}${selected.active ? "" : " (archived)"}`
    : (placeholder ?? `Select ${config.singular.toLowerCase()}…`);

  const openDialog = (mode: "list" | "create", initialName?: string) => {
    setOpen(false);
    setDialog({ open: true, mode, initialName });
  };

  // Offered whenever something is stored, including a selection the current
  // filter now excludes — otherwise a stale assignment cannot be removed.
  const showClear = value !== "";
  const clearValue = () => {
    onChange("");
    // Keeps validation in step with the form's onBlur mode, so a required
    // field surfaces its existing message straight away.
    onBlur?.();
  };

  return (
    <>
      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              {...controlProps}
              onBlur={onBlur}
              className={cn(
                "min-w-0 flex-1 justify-between font-normal",
                !selected && "text-muted-foreground"
              )}
            >
              <span className="truncate">{triggerLabel}</span>
              <ChevronsUpDown
                className="ml-1 size-4 shrink-0 opacity-50"
                aria-hidden="true"
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[--radix-popover-trigger-width] min-w-64 p-0"
            align="start"
          >
            <Command>
              <CommandInput
                placeholder={`Search ${config.plural.toLowerCase()}…`}
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>
                  {emptyLabel ?? `No ${config.plural.toLowerCase()} found.`}
                </CommandEmpty>
                <CommandGroup>
                  {allowClear && (
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        onChange("");
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          value === "" ? "opacity-100" : "opacity-0"
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground">
                        Not assigned
                      </span>
                    </CommandItem>
                  )}
                  {options.map((record) => {
                    const sublabel = config.optionSublabel?.(record);
                    return (
                      <CommandItem
                        key={record.id}
                        value={`${record.name} ${record.code ?? ""}`}
                        onSelect={() => {
                          onChange(record.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "size-4",
                            record.id === value ? "opacity-100" : "opacity-0"
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {record.name}
                          {!record.active && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (archived)
                            </span>
                          )}
                        </span>
                        {sublabel && (
                          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                            {sublabel}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__add_new__"
                    onSelect={() => openDialog("create", query.trim())}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add new {config.singular.toLowerCase()}
                    {query.trim() && (
                      <span className="text-muted-foreground">
                        “{query.trim()}”
                      </span>
                    )}
                  </CommandItem>
                  <CommandItem
                    value="__manage__"
                    onSelect={() => openDialog("list")}
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                    Manage {config.plural.toLowerCase()}…
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {showClear && (
          <ClearValueButton
            label={clearLabel ?? `Clear ${config.singular.toLowerCase()}`}
            onClear={clearValue}
            disabled={disabled}
          />
        )}

        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={`Manage ${config.plural.toLowerCase()}`}
          onClick={() => openDialog("list")}
        >
          <Settings2 aria-hidden="true" />
        </Button>
      </div>

      <MasterDataDialog
        kind={kind}
        open={dialog.open}
        onOpenChange={(o) => setDialog((prev) => ({ ...prev, open: o }))}
        initialMode={dialog.mode}
        initialName={dialog.initialName}
        onCreated={(record) => {
          if (!filter || filter(record)) onChange(record.id);
        }}
        onMutated={onMutated}
      />
    </>
  );
}
