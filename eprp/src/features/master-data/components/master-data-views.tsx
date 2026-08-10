"use client";

import Link from "next/link";

import type {
  Contact,
  Department,
  Discipline,
  MasterRecordBase,
  System,
} from "@/types";
import { StatusBadge } from "@/components/shared";
import { useMasterData } from "../use-master-data";
import {
  getContactById,
  getDepartmentById,
  getJobTitleById,
  getSystemById,
} from "../services";
import { MasterDataListView } from "./master-data-list-view";
import type { MasterDataColumn } from "./master-data-table";

const codeColumn: MasterDataColumn<MasterRecordBase> = {
  header: "Code",
  className: "font-mono text-xs",
  render: (r) => r.code ?? "—",
};

function departmentName(id: string | undefined): string {
  const dept = getDepartmentById(id);
  if (!dept) return "—";
  return dept.active ? dept.name : `${dept.name} (archived)`;
}

/** Deep-link params forwarded from the page search params. */
export interface MasterListViewProps {
  focusId?: string;
  focusMode?: "view" | "edit";
  returnTo?: string;
}

/** /departments — links each row to its detail page. */
export function DepartmentsListView(props: MasterListViewProps = {}) {
  // Subscribe to contacts so lead names refresh when contacts change.
  useMasterData("contact");
  const columns: MasterDataColumn<MasterRecordBase>[] = [
    {
      header: "Name",
      render: (r) => (
        <Link href={`/departments/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    codeColumn,
    {
      header: "Department Lead",
      render: (r) => getContactById((r as Department).leadContactId)?.name ?? "—",
    },
  ];
  return (
    <MasterDataListView
      {...props}
      kind="department"
      eyebrow="Master Data"
      description="Departments participating in progress reporting. Add, edit, archive, or delete departments."
      columns={columns}
      pageBasePath="/departments"
    />
  );
}

/** /systems — related department shown, inline add/edit dialogs. */
export function SystemsListView(props: MasterListViewProps = {}) {
  useMasterData("department");
  const columns: MasterDataColumn<MasterRecordBase>[] = [
    {
      header: "System Name",
      render: (r) => (
        <Link href={`/systems/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    codeColumn,
    {
      header: "Related Department",
      render: (r) => departmentName((r as System).departmentId),
    },
  ];
  return (
    <MasterDataListView
      {...props}
      kind="system"
      pageBasePath="/systems"
      eyebrow="Master Data"
      description="Plant and facility systems, grouped by owning department."
      columns={columns}
    />
  );
}

/** /disciplines — related department shown, inline add/edit dialogs. */
export function DisciplinesListView(props: MasterListViewProps = {}) {
  useMasterData("department");
  useMasterData("system");
  const columns: MasterDataColumn<MasterRecordBase>[] = [
    {
      header: "Name",
      render: (r) => (
        <Link
          href={`/disciplines/${r.id}`}
          className="font-medium hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    codeColumn,
    {
      header: "System",
      /*
       * System is mandatory for anything created or edited from now on. Legacy
       * rows can still hold NULL where the backfill could not determine the
       * mapping without guessing — those are flagged here so they are visible
       * and can be mapped by hand, rather than sitting silently incomplete.
       */
      render: (r) => {
        const systemId = (r as Discipline).systemId;
        if (systemId) return getSystemById(systemId)?.name ?? "—";
        return (
          <StatusBadge tone="warning">
            Requires manual System mapping
          </StatusBadge>
        );
      },
    },
    {
      header: "Related Department",
      render: (r) => departmentName((r as Discipline).departmentId),
    },
  ];
  return (
    <MasterDataListView
      {...props}
      kind="discipline"
      pageBasePath="/disciplines"
      eyebrow="Master Data"
      description="Engineering disciplines used for progress breakdowns, grouped by department."
      columns={columns}
    />
  );
}

/** /administration/job-titles — flexible, admin-managed job titles. */
export function JobTitlesListView(props: MasterListViewProps = {}) {
  const columns: MasterDataColumn<MasterRecordBase>[] = [
    {
      header: "Job Title",
      render: (r) => (
        <Link
          href={`/administration/job-titles/${r.id}`}
          className="font-medium hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    codeColumn,
    {
      header: "Description",
      className: "text-muted-foreground",
      render: (r) => r.description ?? "—",
    },
  ];
  return (
    <MasterDataListView
      {...props}
      kind="jobTitle"
      pageBasePath="/administration/job-titles"
      // Detail page, no separate edit route — edits happen in place.
      editMode="dialog"
      eyebrow="Administration"
      description="Job titles used across the people directory. A title is a label, never a permission — platform access comes from roles."
      columns={columns}
    />
  );
}

/** /contacts — people directory, inline add/edit dialogs. */
export function ContactsListView(props: MasterListViewProps = {}) {
  useMasterData("department");
  useMasterData("jobTitle");
  const columns: MasterDataColumn<MasterRecordBase>[] = [
    {
      header: "Full Name",
      render: (r) => (
        <Link href={`/contacts/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      header: "Job Title",
      render: (r) => {
        const contact = r as Contact;
        const managed = getJobTitleById(contact.jobTitleId);
        if (managed) {
          return managed.active ? managed.name : `${managed.name} (archived)`;
        }
        return contact.position || "—";
      },
    },
    {
      header: "Organization",
      render: (r) => (r as Contact).organization ?? "—",
    },
    {
      header: "Department",
      render: (r) => departmentName((r as Contact).departmentId),
    },
    {
      header: "Email",
      className: "text-muted-foreground",
      render: (r) => (r as Contact).email ?? "—",
    },
  ];
  return (
    <MasterDataListView
      {...props}
      kind="contact"
      pageBasePath="/contacts"
      eyebrow="Master Data"
      description="People referenced across projects — managers, coordinators, leads, and client contacts."
      columns={columns}
    />
  );
}
