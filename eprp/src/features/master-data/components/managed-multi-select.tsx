"use client";

import * as React from "react";
import { ChevronsUpDown, Plus, Settings2 } from "lucide-react";

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
import type { HierarchyTerms } from "@/config/project-terminology";
import type { MasterRecordBase } from "@/types";
import { MASTER_KIND_CONFIG } from "../services";
import type { MasterKind } from "../types";
import { useMasterData } from "../use-master-data";
import { MasterDataDialog } from "./master-data-dialog";

/**
 * Imperative access to the picker's own inline creation dialog.
 *
 * A screen sometimes needs a second trigger for the SAME create action — a
 * Project Setup step offers "+ Add System" in its card header as well as
 * "+ Add new system" inside the dropdown. Both must behave identically, so
 * they drive this one dialog rather than each owning a create surface.
 */
export interface ManagedMultiSelectHandle {
  /** Open the create form, exactly as the in-dropdown "Add new…" does. */
  openCreate: (initialName?: string) => void;
}

export interface ManagedMultiSelectProps {
  ref?: React.Ref<ManagedMultiSelectHandle>;
  kind: MasterKind;
  value: string[];
  onChange: (ids: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Narrow the options, e.g. systems belonging to one department. */
  filter?: (record: MasterRecordBase) => boolean;
  /**
   * Prefill applied to records created inline from this picker, keyed by
   * master-data field key. Pass the scope the surrounding screen already
   * knows — the department a System is being added under — so the shared
   * record lands correctly linked without the user re-entering it.
   */
  createPresetValues?: Record<string, string>;
  /** Text shown when the filter leaves nothing to choose from. */
  emptyLabel?: string;
  /**
   * Wording for the search box, when the caller's screen names this kind
   * differently from Global Administration — see the note on the same prop in
   * `ManagedSelect`. Overrides one string; it does not rename the kind.
   */
  searchPlaceholder?: string;
  /** Heading over the option list, when the caller names the kind differently. */
  optionsHeading?: string;
  /** Project-type wording for the hierarchy level; display only. */
  displayTerms?: HierarchyTerms;
  /** Optional context-specific metadata shown and included in typeahead. */
  optionSublabel?: (record: MasterRecordBase) => string | undefined;
  /**
   * Split the options into labelled groups, in the order returned.
   *
   * Used so a Team Member picker can offer people from the active Department
   * and people from another one in the SAME list — the assignment is legal
   * either way — while making it obvious which is which before the user picks.
   * Returning `undefined` for a record leaves it in the default group.
   */
  optionGroup?: (record: MasterRecordBase) => string | undefined;
  /** Group headings in display order; groups with no options are skipped. */
  optionGroupOrder?: string[];
  /**
   * Accessible name for the "×" button, e.g. "Clear all disciplines".
   * Defaults to the master-data kind when the field has no distinct name.
   */
  clearLabel?: string;
  controlProps?: {
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    "aria-required"?: boolean;
  };
  onMutated?: () => void;
}

/**
 * Searchable multi-select backed by the existing managed master-data store.
 *
 * A "×" appears once anything is selected and removes every assignment from
 * this form; the master-data records themselves are never touched.
 */
export function ManagedMultiSelect({
  ref,
  kind,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  filter,
  createPresetValues,
  emptyLabel,
  searchPlaceholder,
  optionsHeading,
  displayTerms,
  optionSublabel,
  optionGroup,
  optionGroupOrder,
  clearLabel,
  controlProps,
  onMutated,
}: ManagedMultiSelectProps) {
  const config = MASTER_KIND_CONFIG[kind];
  const singular = displayTerms?.singular ?? config.singular;
  const plural = displayTerms?.plural ?? config.plural;
  const singularLower = displayTerms?.singularLower ?? singular.toLowerCase();
  const pluralLower = displayTerms?.pluralLower ?? plural.toLowerCase();
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

  /*
   * Options split into their display groups. Without `optionGroup` this is a
   * single group and renders exactly as it did before.
   */
  const groupedOptions = React.useMemo(() => {
    const defaultHeading = optionsHeading ?? plural;
    if (!optionGroup) return [{ heading: defaultHeading, records: options }];

    const buckets = new Map<string, MasterRecordBase[]>();
    for (const record of options) {
      const heading = optionGroup(record) ?? defaultHeading;
      buckets.set(heading, [...(buckets.get(heading) ?? []), record]);
    }

    const ordered = optionGroupOrder ?? [...buckets.keys()];
    const seen = new Set(ordered);
    return [
      ...ordered,
      // Any heading the caller did not list still has to appear.
      ...[...buckets.keys()].filter((heading) => !seen.has(heading)),
    ]
      .map((heading) => ({ heading, records: buckets.get(heading) ?? [] }))
      .filter((group) => group.records.length > 0);
  }, [options, optionGroup, optionGroupOrder, optionsHeading, plural]);

  const triggerLabel =
    selectedRecords.length === 0
      ? (placeholder ?? `Select ${pluralLower}…`)
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

  // `openDialog` closes over setState functions only, so the handle is
  // stable for the life of the component.
  React.useImperativeHandle(
    ref,
    () => ({
      openCreate: (initialName?: string) => openDialog("create", initialName),
    }),
    []
  );

  const clearValue = () => {
    onChange([]);
    // Matches the form's onBlur validation mode, so a required field shows
    // its existing "select at least one…" message immediately.
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
                placeholder={
                  searchPlaceholder ?? `Search ${pluralLower}…`
                }
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>
                  {emptyLabel ?? `No ${pluralLower} found.`}
                </CommandEmpty>
                {groupedOptions.map(({ heading, records: groupRecords }) => (
                  <CommandGroup key={heading} heading={heading}>
                    {groupRecords.map((record) => {
                      const checked = selectedIds.has(record.id);
                      const sublabel =
                        optionSublabel?.(record) ??
                        config.optionSublabel?.(record);
                      return (
                        <CommandItem
                          key={record.id}
                          value={`${record.name} ${record.code ?? ""} ${sublabel ?? ""}`}
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
                          {(sublabel || record.code) && (
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {sublabel ?? record.code}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__add_new__"
                    onSelect={() => openDialog("create", query.trim())}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add new {singularLower}
                  </CommandItem>
                  <CommandItem
                    value="__manage__"
                    onSelect={() => openDialog("list")}
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                    Manage {pluralLower}…
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {value.length > 0 && (
          <ClearValueButton
            label={clearLabel ?? `Clear all ${pluralLower}`}
            onClear={clearValue}
            disabled={disabled}
          />
        )}

        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={`Manage ${pluralLower}`}
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
        presetValues={createPresetValues}
        displayTerms={displayTerms}
        onCreated={(record) => onChange([...value, record.id])}
        onMutated={onMutated}
      />
    </>
  );
}
