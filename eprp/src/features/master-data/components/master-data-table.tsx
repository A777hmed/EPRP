"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  Eye,
  MoreHorizontal,
  PenLine,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { MasterRecordBase } from "@/types";

export interface MasterDataColumn<T extends MasterRecordBase> {
  header: string;
  render: (record: T) => React.ReactNode;
  className?: string;
}

export interface MasterDataTableProps<T extends MasterRecordBase> {
  records: T[];
  columns: MasterDataColumn<T>[];
  emptyLabel?: string;
  onView?: (record: T) => void;
  /*
   * Optional, like `onView`: a caller that may not mutate master data omits
   * these, and the corresponding menu items are not rendered. The row and its
   * View action stay, because master-data SELECT is `USING (true)` while every
   * INSERT/UPDATE/DELETE is `has_global_operational_authority()`.
   */
  onEdit?: (record: T) => void;
  onArchive?: (record: T) => void;
  onRestore?: (record: T) => void;
  onDelete?: (record: T) => void;
}

/**
 * Reusable master-data table: caller-defined columns plus a status badge
 * and a row action menu (View / Edit / Archive · Restore / Delete).
 * Used by every master-data list view.
 */
export function MasterDataTable<T extends MasterRecordBase>({
  records,
  columns,
  emptyLabel = "No records found.",
  onView,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: MasterDataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.header} className={col.className}>
                {col.header}
              </TableHead>
            ))}
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length + 2}
                className="py-10 text-center text-muted-foreground"
              >
                {emptyLabel}
              </TableCell>
            </TableRow>
          )}
          {records.map((record) => (
            <TableRow key={record.id} className={cn(!record.active && "opacity-70")}>
              {columns.map((col) => (
                <TableCell key={col.header} className={col.className}>
                  {col.render(record)}
                </TableCell>
              ))}
              <TableCell>
                {record.active ? (
                  <StatusBadge tone="success">Active</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">Archived</StatusBadge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${record.name}`}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {onView && (
                      <DropdownMenuItem onClick={() => onView(record)}>
                        <Eye aria-hidden="true" /> View
                      </DropdownMenuItem>
                    )}
                    {onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(record)}>
                        <PenLine aria-hidden="true" /> Edit
                      </DropdownMenuItem>
                    )}
                    {record.active
                      ? onArchive && (
                          <DropdownMenuItem onClick={() => onArchive(record)}>
                            <Archive aria-hidden="true" /> Archive
                          </DropdownMenuItem>
                        )
                      : onRestore && (
                          <DropdownMenuItem onClick={() => onRestore(record)}>
                            <ArchiveRestore aria-hidden="true" /> Restore
                          </DropdownMenuItem>
                        )}
                    {onDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDelete(record)}
                        >
                          <Trash2 aria-hidden="true" /> Delete…
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
