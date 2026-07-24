"use client";

import * as React from "react";
import { ChevronsUpDown, Plus, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

export interface ManagedMultiSelectProps {
  kind: MasterKind;
  value: string[];
  onChange: (ids: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Narrow the options, e.g. systems belonging to one department. */
  filter?: (record: MasterRecordBase) => boolean;
  /** Text shown when the filter leaves nothing to choose from. */
  emptyLabel?: string;
  controlProps?: {
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    "aria-required"?: boolean;
  };
  onMutated?: () => void;
}

/** Searchable multi-select backed by the existing managed master-data store. */
export function ManagedMultiSelect({
  kind,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  filter,
  emptyLabel,
  controlProps,
  onMutated,
}: ManagedMultiSelectProps) {
  const config = MASTER_KIND_CONFIG[kind];
  const { records, activeRecords } = useMasterData(kind);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    mode: "list" | "create";
    initialName?: string;
  }>({ open: false, mode: "list" });

  const selectedIds = React.useMemo(() => new Set(value), [value]);
  const selectedRecords = value
    .map((id) => records.find((record) => record.id === id))
    .filter((record): record is MasterRecordBase => record !== undefined);

  // Archived historical selections remain visible, while new choices only
  // come from active managed data.
  const options = React.useMemo(() => {
    const archivedSelections = records.filter(
      (record) => selectedIds.has(record.id) && !record.active
    );
    const all = [...archivedSelections, ...activeRecords];
    if (!filter) return all;
    // Anything already selected stays listed even when the filter excludes
    // it — otherwise a pre-existing choice becomes invisible and impossible
    // to remove.
    return all.filter((record) => filter(record) || selectedIds.has(record.id));
  }, [activeRecords, records, selectedIds, filter]);

  const triggerLabel =
    selectedRecords.length === 0
      ? (placeholder ?? `Select ${config.plural.toLowerCase()}…`)
      : selectedRecords.length <= 2
        ? selectedRecords.map((record) => record.name).join(", ")
        : `${selectedRecords
            .slice(0, 2)
            .map((record) => record.name)
            .join(", ")} +${selectedRecords.length - 2}`;

  const toggle = (id: string) => {
    onChange(
      selectedIds.has(id)
        ? value.filter((selectedId) => selectedId !== id)
        : [...value, id]
    );
  };

  const openDialog = (mode: "list" | "create", initialName?: string) => {
    setOpen(false);
    setDialog({ open: true, mode, initialName });
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
                selectedRecords.length === 0 && "text-muted-foreground"
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
            className="w-[--radix-popover-trigger-width] min-w-72 p-0"
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
                <CommandGroup heading={config.plural}>
                  {options.map((record) => {
                    const checked = selectedIds.has(record.id);
                    return (
                      <CommandItem
                        key={record.id}
                        value={`${record.name} ${record.code ?? ""}`}
                        data-checked={checked || undefined}
                        aria-selected={checked}
                        onSelect={() => toggle(record.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {record.name}
                          {!record.active && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (archived)
                            </span>
                          )}
                        </span>
                        {record.code && (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {record.code}
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
        onOpenChange={(nextOpen) =>
          setDialog((previous) => ({ ...previous, open: nextOpen }))
        }
        initialMode={dialog.mode}
        initialName={dialog.initialName}
        onCreated={(record) => onChange([...value, record.id])}
        onMutated={onMutated}
      />
    </>
  );
}
