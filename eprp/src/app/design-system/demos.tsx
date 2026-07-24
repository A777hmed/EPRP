"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConfirmDialog,
  ErrorState,
  FilterBar,
  SearchInput,
} from "@/components/shared";

export function SearchInputDemo() {
  const [query, setQuery] = React.useState("");

  return (
    <div className="space-y-2">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search projects…"
      />
      <p className="text-xs text-muted-foreground tabular-nums">
        {query ? `Query: “${query}”` : "Type to see the controlled value."}
      </p>
    </div>
  );
}

const departments = ["Engineering", "Operations", "Finance", "HR"];
const statuses = ["On Track", "At Risk", "Delayed", "Completed"];

export function FilterBarDemo() {
  const [query, setQuery] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [status, setStatus] = React.useState("");

  const activeCount = [query, department, status].filter(Boolean).length;

  return (
    <FilterBar
      activeCount={activeCount}
      onReset={() => {
        setQuery("");
        setDepartment("");
        setStatus("");
      }}
    >
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search projects…"
        containerClassName="w-full sm:w-64"
      />
      <Select value={department} onValueChange={setDepartment}>
        <SelectTrigger className="w-40" aria-label="Filter by department">
          <SelectValue placeholder="Department" />
        </SelectTrigger>
        <SelectContent>
          {departments.map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-36" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterBar>
  );
}

export function ErrorStateDemo() {
  const [attempts, setAttempts] = React.useState(0);

  return (
    <div className="space-y-2">
      <ErrorState onRetry={() => setAttempts((n) => n + 1)} />
      {attempts > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Retry triggered {attempts} {attempts === 1 ? "time" : "times"}.
        </p>
      )}
    </div>
  );
}

export function ConfirmDialogDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={<Button variant="outline">Submit report</Button>}
        title="Submit progress report?"
        description="The report will be sent to the PMO for approval. You can withdraw it while it is pending."
        confirmLabel="Submit report"
        onConfirm={() => new Promise((resolve) => setTimeout(resolve, 900))}
      />
      <ConfirmDialog
        trigger={
          <Button variant="destructive">
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Delete project
          </Button>
        }
        title="Delete this project?"
        description="This removes the project and all of its progress reports. This action cannot be undone."
        confirmLabel="Delete project"
        destructive
        onConfirm={() => new Promise((resolve) => setTimeout(resolve, 900))}
      />
    </div>
  );
}
