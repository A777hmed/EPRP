"use client";

import * as React from "react";
import {
  Building2,
  FolderKanban,
  Link2,
  MoreHorizontal,
  PenLine,
  Plus,
  Power,
  PowerOff,
  SearchX,
  Unlink,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  SearchInput,
  StatCard,
  StatusBadge,
} from "@/components/shared";
import { ROLE_LABELS } from "@/config/permissions";
import type { UserRole } from "@/types";
import {
  LAST_ADMIN_BLOCKED_MESSAGE,
  SET_INACTIVE_WARNING,
  UNLINK_PERSON_DESCRIPTION,
} from "../copy";
import { fetchAdminUsersData } from "../data";
import { wouldOrphanActiveAdmins } from "../guards";
import { client } from "../supabase-client";
import type { UserRow } from "../types";
import { UserFormDialog } from "./user-form-dialog";

const ALL_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

interface Filters {
  query: string;
  role: UserRole | "all";
  projectId: string | "all";
  status: "active" | "inactive" | "all";
}

const defaultFilters: Filters = {
  query: "",
  role: "all",
  projectId: "all",
  status: "all",
};

/**
 * Name column value: the linked Person's real name when there is one,
 * otherwise the profile's own account name — never the linkage-status text
 * "Person Not Linked", which belongs only in the Linked Person column.
 */
function displayName(row: UserRow): string {
  if (row.personName) return row.personName;
  const trimmed = row.fullName?.trim();
  return trimmed ? trimmed : "No Display Name";
}

/**
 * Administration → Users & Roles.
 *
 * Links Supabase Auth accounts (`profiles`) to people already in the
 * directory (`contacts`) and shows the platform role that flows from that
 * link. The table itself stays to identity + access only — project
 * responsibility, department scope, and work email are read-only detail
 * inside the Edit dialog, not table columns, so the table stays narrow at
 * normal desktop widths. Reached only by a System Administrator — enforced
 * both by the server page and by RLS on `profiles`.
 */
export function UsersRolesView() {
  const [rows, setRows] = React.useState<UserRow[] | null>(null);
  const [contacts, setContacts] = React.useState<AdminData["contacts"]>([]);
  const [projects, setProjects] = React.useState<AdminData["projects"]>([]);
  const [error, setError] = React.useState(false);
  const [filters, setFilters] = React.useState(defaultFilters);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [dialog, setDialog] = React.useState<
    { mode: "add" } | { mode: "edit"; row: UserRow } | null
  >(null);
  const [unlinkTarget, setUnlinkTarget] = React.useState<UserRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = React.useState<UserRow | null>(
    null
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAdminUsersData();
        if (cancelled) return;
        setRows(data.rows);
        setContacts(data.contacts);
        setProjects(data.projects);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => {
    setError(false);
    setRows(null);
    setReloadKey((k) => k + 1);
  };

  const stats = React.useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      active: all.filter((r) => r.active).length,
      projectAssigned: all.filter((r) => r.assignments.length > 0).length,
      departmentScoped: all.filter((r) =>
        r.assignments.some((a) => a.departmentName)
      ).length,
    };
  }, [rows]);

  const projectOptions = React.useMemo(
    () =>
      [...projects]
        .map((p) => ({ id: p.id, label: p.shortName ?? p.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [projects]
  );

  const visible = React.useMemo(() => {
    const all = rows ?? [];
    const query = filters.query.trim().toLowerCase();
    return all.filter((row) => {
      if (filters.role !== "all" && row.role !== filters.role) return false;
      if (filters.status === "active" && !row.active) return false;
      if (filters.status === "inactive" && row.active) return false;
      if (
        filters.projectId !== "all" &&
        !row.assignments.some((a) => a.projectId === filters.projectId)
      )
        return false;
      if (query) {
        const haystack = `${row.personName ?? ""} ${row.loginEmail} ${row.workEmail ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const activeFilters =
    (filters.query ? 1 : 0) +
    (filters.role !== "all" ? 1 : 0) +
    (filters.projectId !== "all" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0);

  const handleUnlink = async (row: UserRow) => {
    try {
      const supabase = client();
      const { error: unlinkError } = await supabase
        .from("profiles")
        .update({ contact_id: null })
        .eq("id", row.profileId);
      if (unlinkError) throw new Error(unlinkError.message);
      toast.success("Person unlinked from this account");
      reload();
    } catch (unlinkError) {
      toast.error(
        unlinkError instanceof Error
          ? unlinkError.message
          : "Could not unlink this person."
      );
    }
  };

  const handleSetActive = async (row: UserRow, active: boolean) => {
    try {
      const supabase = client();
      const { error: statusError } = await supabase
        .from("profiles")
        .update({ active })
        .eq("id", row.profileId);
      if (statusError) throw new Error(statusError.message);
      toast.success(active ? "Account set to Active" : "Account set to Inactive");
      reload();
    } catch (statusError) {
      toast.error(
        statusError instanceof Error
          ? statusError.message
          : "Could not update this account."
      );
    }
  };

  const handleSetInactiveClick = (row: UserRow) => {
    if (
      wouldOrphanActiveAdmins(row, rows ?? [], {
        role: row.role,
        active: false,
      })
    ) {
      toast.error(LAST_ADMIN_BLOCKED_MESSAGE);
      return;
    }
    setDeactivateTarget(row);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Users & Roles"
        description="Create or link platform accounts, connect them to people in the directory, and set platform access. Project responsibility, department scope, and work email are managed in each project's Team & Responsibilities screen and shown read-only in Edit User."
        actions={
          <Button onClick={() => setDialog({ mode: "add" })}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add User
          </Button>
        }
      />

      <section aria-label="Users summary">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total Users" value={String(stats.total)} icon={Users} />
          <StatCard label="Active" value={String(stats.active)} icon={UserCheck} />
          <StatCard
            label="Project Assigned"
            value={String(stats.projectAssigned)}
            icon={FolderKanban}
          />
          <StatCard
            label="Department Scoped"
            value={String(stats.departmentScoped)}
            icon={Building2}
          />
        </div>
      </section>

      <FilterBar
        activeCount={activeFilters}
        onReset={() => setFilters(defaultFilters)}
      >
        <SearchInput
          value={filters.query}
          onValueChange={(query) => setFilters((f) => ({ ...f, query }))}
          placeholder="Search name or email…"
          containerClassName="w-full sm:w-60"
        />
        <Select
          value={filters.role}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, role: v as Filters["role"] }))
          }
        >
          <SelectTrigger className="w-48" aria-label="Filter by platform role">
            <SelectValue placeholder="Platform role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ALL_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.projectId}
          onValueChange={(v) => setFilters((f) => ({ ...f, projectId: v }))}
        >
          <SelectTrigger className="w-44" aria-label="Filter by project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projectOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, status: v as Filters["status"] }))
          }
        >
          <SelectTrigger className="w-32" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <p className="text-xs text-muted-foreground">
        Platform Role lists the database&rsquo;s current nine roles as-is — an
        interim set, not the final product role model.
      </p>

      {error ? (
        <ErrorState
          title="Users could not be loaded"
          description="The account list failed to load. Try again."
          onRetry={reload}
        />
      ) : rows === null ? (
        <LoadingState variant="table" count={6} label="Loading users…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No platform accounts yet"
          description="Create a new account, or link an existing login account to a person in the directory, to get started."
          action={
            <Button onClick={() => setDialog({ mode: "add" })}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add User
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No users match your filters"
          description="Try a different search or reset the filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Login Email</TableHead>
                <TableHead>Platform Role</TableHead>
                <TableHead>Linked Person</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.profileId}>
                  <TableCell className="min-w-32 max-w-48 align-top font-medium whitespace-normal break-words">
                    {displayName(row)}
                  </TableCell>
                  <TableCell className="min-w-48 max-w-72 align-top whitespace-normal break-words text-muted-foreground">
                    {row.loginEmail}
                  </TableCell>
                  <TableCell className="min-w-36 align-top whitespace-nowrap">
                    <StatusBadge tone="info">{ROLE_LABELS[row.role]}</StatusBadge>
                  </TableCell>
                  <TableCell className="min-w-32 max-w-48 align-top whitespace-normal break-words">
                    {row.contactId ? (
                      <div className="space-y-1">
                        <StatusBadge tone="success">Person Linked</StatusBadge>
                        {row.jobTitle && (
                          <p className="text-xs text-muted-foreground">
                            {row.jobTitle}
                          </p>
                        )}
                      </div>
                    ) : (
                      <StatusBadge tone="warning">Person Not Linked</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="align-top whitespace-nowrap">
                    <StatusBadge tone={row.active ? "success" : "neutral"}>
                      {row.active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="align-top text-right whitespace-nowrap">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${row.personName ?? row.loginEmail}`}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onClick={() => setDialog({ mode: "edit", row })}
                        >
                          <PenLine aria-hidden="true" /> Edit User
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDialog({ mode: "edit", row })}
                        >
                          <Link2 aria-hidden="true" />
                          {row.contactId ? "Change Linked Person" : "Link Person"}
                        </DropdownMenuItem>
                        {row.contactId && (
                          <DropdownMenuItem onClick={() => setUnlinkTarget(row)}>
                            <Unlink aria-hidden="true" /> Unlink Person
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {row.active ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleSetInactiveClick(row)}
                          >
                            <PowerOff aria-hidden="true" /> Set Inactive
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleSetActive(row, true)}
                          >
                            <Power aria-hidden="true" /> Set Active
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog && (
        <UserFormDialog
          open={dialog !== null}
          onOpenChange={(open) => !open && setDialog(null)}
          mode={dialog.mode}
          row={dialog.mode === "edit" ? dialog.row : undefined}
          allRows={rows ?? []}
          contacts={contacts}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={unlinkTarget !== null}
        onOpenChange={(o) => !o && setUnlinkTarget(null)}
        title="Unlink this person?"
        description={UNLINK_PERSON_DESCRIPTION}
        confirmLabel="Unlink Person"
        destructive
        onConfirm={async () => {
          if (unlinkTarget) await handleUnlink(unlinkTarget);
        }}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title={`Set ${deactivateTarget?.personName ?? deactivateTarget?.loginEmail ?? "this account"} to Inactive?`}
        description={SET_INACTIVE_WARNING}
        confirmLabel="Set Inactive"
        destructive
        onConfirm={async () => {
          if (deactivateTarget) await handleSetActive(deactivateTarget, false);
        }}
      />
    </div>
  );
}

type AdminData = Awaited<ReturnType<typeof fetchAdminUsersData>>;
