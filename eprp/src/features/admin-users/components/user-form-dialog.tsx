"use client";

import * as React from "react";
import { AlertTriangle, Loader2, UserX, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog, EmptyState, StatusBadge } from "@/components/shared";
import { ROLE_LABELS } from "@/config/permissions";
import { PasswordInput } from "@/features/auth/components/password-input";
import { PasswordRulesHint } from "@/features/auth/components/password-rules-hint";
import { validateNewPassword } from "@/features/auth/password";
import { ManagedPersonSelect } from "@/features/master-data";
import type { Contact, UserRole } from "@/types";
import {
  createUserAccount,
  listAuthAccountsWithoutProfile,
  type AuthAccountWithoutProfile,
} from "../actions";
import {
  ACTIVE_FIELD_DESCRIPTION,
  changeLinkedPersonDescription,
  LAST_ADMIN_BLOCKED_MESSAGE,
  UNLINK_PERSON_DESCRIPTION,
} from "../copy";
import { generateStrongPassword } from "../generate-password";
import { wouldOrphanActiveAdmins } from "../guards";
import { client } from "../supabase-client";
import type { UserRow } from "../types";

const ALL_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

export interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  /** Required in edit mode. */
  row?: UserRow;
  /** Every current row — used to warn when a Person is already linked elsewhere, and to guard the last active System Administrator. */
  allRows: UserRow[];
  contacts: Contact[];
  onSaved: () => void;
}

/**
 * Compact read-only preview of a selected Contact's Job Title and Project
 * Work Email — shared by Create New Account and the Person section, since
 * neither ever edits the Contact itself.
 */
function ContactPreview({ contact }: { contact: Contact }) {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p>
        <span className="text-muted-foreground">Job Title: </span>
        {contact.position?.trim() || "—"}
      </p>
      <p>
        <span className="text-muted-foreground">
          Project Work Email (Read-only):{" "}
        </span>
        {contact.email?.trim() || "—"}
      </p>
    </div>
  );
}

/**
 * "Add User" (Create New Account, default, or Link Existing Account — a
 * secondary recovery path for an Auth account that already exists but has
 * no platform profile) and "Edit User" share this dialog: all three walk
 * the same chain — Auth Account → Platform Profile → Linked Person.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  mode,
  row,
  allRows,
  contacts,
  onSaved,
}: UserFormDialogProps) {
  const [addTab, setAddTab] = React.useState<"create" | "link">("create");

  /* ------------------------- Link Existing Account ------------------------ */

  const [accountsWithoutProfile, setAccountsWithoutProfile] = React.useState<
    AuthAccountWithoutProfile[] | null
  >(null);
  const [accountsError, setAccountsError] = React.useState<string | null>(
    null
  );
  const [authUserId, setAuthUserId] = React.useState("");

  // The Person currently persisted on this profile ("" when never linked).
  const originalContactId = row?.contactId ?? "";
  // The picker's current selection — updates immediately so the picker (and
  // the Job Title / Work Email preview) reflects what's chosen, but this is
  // NOT what gets written: saving a change away from `originalContactId`
  // always routes through the confirmation below first.
  const [contactId, setContactId] = React.useState(originalContactId);
  const [role, setRole] = React.useState<UserRole>(row?.role ?? "viewer");
  const [active, setActive] = React.useState(row?.active ?? true);
  const [saving, setSaving] = React.useState(false);

  const [personChangeConfirmOpen, setPersonChangeConfirmOpen] =
    React.useState(false);
  // Distinguishes "closed because confirmed" from "closed because cancelled"
  // in the shared onOpenChange handler below, so only a genuine Cancel
  // reverts the pending selection.
  const personChangeConfirmed = React.useRef(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = React.useState(false);

  const noEligibleAccounts =
    mode === "add" &&
    addTab === "link" &&
    accountsWithoutProfile !== null &&
    !accountsError &&
    accountsWithoutProfile.length === 0;

  /** Also called imperatively after a "profile_incomplete" Create New
   * Account result, so the newly-created Auth account appears in Link
   * Existing Account immediately without closing this dialog. */
  const loadAccountsWithoutProfile = React.useCallback(async () => {
    setAccountsWithoutProfile(null);
    setAccountsError(null);
    try {
      const accounts = await listAuthAccountsWithoutProfile();
      setAccountsWithoutProfile(accounts);
    } catch (error) {
      setAccountsWithoutProfile([]);
      setAccountsError(
        error instanceof Error
          ? error.message
          : "Could not load existing login accounts."
      );
    }
  }, []);

  /*
   * No reset-on-open logic here: the parent only renders this dialog while
   * `dialog !== null` (see UsersRolesView), so every open is a fresh mount
   * and the `useState` initializers above already start from the right
   * values (both already `null`, so there is nothing to reset). This effect
   * only has an external system to synchronize with — loading the Auth
   * accounts that have no platform profile yet, for Add mode (needed by the
   * Link Existing Account tab) — so it runs once, and only ever calls
   * setState from the resolved promise, never synchronously in the effect
   * body. `loadAccountsWithoutProfile` above resets state synchronously
   * before re-fetching, which is fine for its own caller (a plain event
   * handler) but not safe to call directly from here.
   */
  React.useEffect(() => {
    if (mode !== "add") return;
    let cancelled = false;
    listAuthAccountsWithoutProfile()
      .then((accounts) => {
        if (!cancelled) setAccountsWithoutProfile(accounts);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAccountsWithoutProfile([]);
        setAccountsError(
          error instanceof Error
            ? error.message
            : "Could not load existing login accounts."
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const originalContact = contacts.find((c) => c.id === originalContactId);
  const selectedContact = contacts.find((c) => c.id === contactId);
  const conflictingRow = contactId
    ? allRows.find(
        (r) => r.contactId === contactId && r.profileId !== row?.profileId
      )
    : undefined;

  const personFieldLabel =
    mode === "add" || !originalContactId ? "Link Person" : "Change Linked Person";

  /**
   * A person swap away from what is currently persisted. Never true for a
   * first-time link (no `originalContactId`) or in Add mode — both create a
   * profile/link that doesn't exist yet, so there's nothing to "change".
   */
  const personChanged =
    mode === "edit" && originalContactId !== "" && contactId !== originalContactId;

  const handleUnlink = async () => {
    if (!row) return;
    try {
      const supabase = client();
      const { error } = await supabase
        .from("profiles")
        .update({ contact_id: null })
        .eq("id", row.profileId);
      if (error) throw new Error(error.message);
      toast.success("Person unlinked from this account");
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not unlink this person."
      );
    }
  };

  const canSave =
    !saving &&
    (mode === "edit" || authUserId !== "") &&
    (mode === "edit" || contactId !== "");

  /**
   * Edit User / Link Existing Account write. This is the only place this
   * dialog inserts/updates `profiles` for an Auth account that already
   * exists, so it is also where the last-active-System-Administrator guard
   * lives for that path — reached whether the save came straight from the
   * footer button or from confirming a person change.
   */
  const performSave = async () => {
    if (mode === "edit" && row) {
      if (
        wouldOrphanActiveAdmins(
          { profileId: row.profileId, role: row.role, active: row.active },
          allRows,
          { role, active }
        )
      ) {
        toast.error(LAST_ADMIN_BLOCKED_MESSAGE);
        return;
      }
    }

    setSaving(true);
    try {
      const supabase = client();

      if (mode === "add") {
        const authUser = accountsWithoutProfile?.find(
          (u) => u.id === authUserId
        );
        if (!authUser) throw new Error("Select an authentication account.");

        const { error } = await supabase.from("profiles").insert({
          id: authUser.id,
          email: authUser.email,
          full_name: selectedContact?.name ?? authUser.email,
          role,
          contact_id: contactId || null,
          active: true,
        });
        if (error) throw new Error(error.message);
        toast.success("Platform profile created and linked");
      } else if (row) {
        const patch: Record<string, unknown> = {
          role,
          active,
          contact_id: contactId || null,
        };
        if (selectedContact) patch.full_name = selectedContact.name;

        const { error } = await supabase
          .from("profiles")
          .update(patch)
          .eq("id", row.profileId);
        if (error) throw new Error(error.message);
        toast.success("User updated");
      }
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save this user."
      );
    } finally {
      setSaving(false);
    }
  };

  /** Footer save click for Edit User / Link Existing Account: a person swap
   * must be confirmed before `performSave` ever runs — everything else
   * saves immediately. */
  const handleSaveClick = () => {
    if (personChanged) {
      setPersonChangeConfirmOpen(true);
      return;
    }
    void performSave();
  };

  /* ------------------------------ Create New Account ----------------------- */

  const [createEmail, setCreateEmail] = React.useState("");
  const [createPassword, setCreatePassword] = React.useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = React.useState("");
  const [createContactId, setCreateContactId] = React.useState("");
  const [createRole, setCreateRole] = React.useState<UserRole>("viewer");
  const [createActive, setCreateActive] = React.useState(true);

  const createSelectedContact = contacts.find((c) => c.id === createContactId);
  const createConflictingRow = createContactId
    ? allRows.find((r) => r.contactId === createContactId)
    : undefined;

  const createEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    createEmail.trim()
  );
  const canCreate =
    !saving &&
    createEmailValid &&
    !validateNewPassword(createPassword, createPasswordConfirm);

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword();
    setCreatePassword(generated);
    setCreatePasswordConfirm(generated);
  };

  const handleCreateAccount = async () => {
    const passwordProblem = validateNewPassword(
      createPassword,
      createPasswordConfirm
    );
    if (passwordProblem) {
      toast.error(passwordProblem);
      return;
    }
    const email = createEmail.trim();
    if (!createEmailValid) {
      toast.error("Enter a valid login email.");
      return;
    }

    setSaving(true);
    try {
      const result = await createUserAccount({
        email,
        password: createPassword,
        contactId: createContactId || null,
        role: createRole,
        active: createActive,
      });

      if (result.status === "profile_incomplete") {
        toast.error(
          "The account was created, but platform profile setup is incomplete. Switched to Link Existing Account to finish it."
        );
        setAddTab("link");
        await loadAccountsWithoutProfile();
        return;
      }

      toast.success(
        "User created successfully. The account can now sign in with the provided login email and password."
      );
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create this user."
      );
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = mode === "add" ? "Add User" : "Edit User";
  const dialogDescription =
    mode === "edit"
      ? "Update this platform profile: which person it represents, its platform role, and its status."
      : addTab === "create"
        ? "Create a new login account, optionally link it to a person, and set its platform access."
        : "Link an existing login account that does not yet have a platform profile.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {mode === "edit" ? (
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Account</FieldLegend>
              <Field>
                <FieldLabel>Login Email</FieldLabel>
                <p className="text-sm font-medium">{row?.loginEmail}</p>
                <FieldDescription>
                  Used to sign in to EPRP. Distinct from Project Work Email
                  below.
                </FieldDescription>
              </Field>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Person</FieldLegend>
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>{personFieldLabel}</FieldLabel>
                  {originalContactId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => setUnlinkConfirmOpen(true)}
                    >
                      Unlink Person
                    </Button>
                  )}
                </div>
                <ManagedPersonSelect
                  value={contactId}
                  onChange={setContactId}
                  placeholder="Search people…"
                  searchPlaceholder="Search people…"
                  allowClear={false}
                  clearable={!originalContactId}
                />
                <FieldDescription>
                  Select an existing person first. Create a new contact only
                  if the person does not already exist.
                </FieldDescription>
              </Field>
              {selectedContact && <ContactPreview contact={selectedContact} />}
              {conflictingRow && (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    This person is already linked to {conflictingRow.loginEmail}.
                    Linking them here too may create a duplicate identity.
                  </span>
                </div>
              )}
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Platform Access</FieldLegend>
              <Field>
                <FieldLabel htmlFor="platform-role">Platform Role</FieldLabel>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger id="platform-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Platform authorization only — the database&rsquo;s current
                  nine roles, shown as-is. This is an interim set, not the
                  final product role model, and is separate from Job Title
                  and from this person&rsquo;s responsibility on any one
                  project.
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="active-toggle">Active</FieldLabel>
                <Switch
                  id="active-toggle"
                  checked={active}
                  onCheckedChange={setActive}
                />
              </Field>
              <FieldDescription>{ACTIVE_FIELD_DESCRIPTION}</FieldDescription>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Project Assignments (Read-only)</FieldLegend>
              <FieldDescription>
                Set on each project&rsquo;s own Team &amp; Responsibilities
                screen, not here. Users &amp; Roles manages only the Login
                Account ↔ Person identity link and platform access.
              </FieldDescription>
              {!row || row.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No project assignments yet. Assign this person from
                  Project → Team &amp; Responsibilities.
                </p>
              ) : (
                <div className="max-h-36 space-y-1.5 overflow-y-auto">
                  {row.assignments.map((a, i) => (
                    <div
                      key={`${a.projectId}-${a.responsibility}-${i}`}
                      className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm"
                    >
                      <span className="font-medium">{a.projectName}</span>
                      <StatusBadge tone="neutral">{a.responsibility}</StatusBadge>
                      {a.departmentName && (
                        <StatusBadge tone="info">{a.departmentName}</StatusBadge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </FieldSet>
          </FieldGroup>
        ) : (
          <Tabs value={addTab} onValueChange={(v) => setAddTab(v as "create" | "link")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">Create New Account</TabsTrigger>
              <TabsTrigger value="link">Link Existing Account</TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="pt-4">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend>Account</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor="create-email">Login Email</FieldLabel>
                    <Input
                      id="create-email"
                      type="email"
                      autoComplete="off"
                      placeholder="name@example.com"
                      value={createEmail}
                      onChange={(e) => setCreateEmail(e.target.value)}
                    />
                    <FieldDescription>
                      Used to sign in to EPRP. This may be different from the
                      Project Work Email.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor="create-password">Password</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={handleGeneratePassword}
                      >
                        <Wand2 aria-hidden="true" /> Generate Password
                      </Button>
                    </div>
                    <PasswordInput
                      id="create-password"
                      autoComplete="new-password"
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                    />
                    <PasswordRulesHint value={createPassword} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="create-password-confirm">
                      Confirm Password
                    </FieldLabel>
                    <PasswordInput
                      id="create-password-confirm"
                      autoComplete="new-password"
                      value={createPasswordConfirm}
                      onChange={(e) => setCreatePasswordConfirm(e.target.value)}
                    />
                  </Field>
                </FieldSet>

                <FieldSeparator />

                <FieldSet>
                  <FieldLegend>Person</FieldLegend>
                  <Field>
                    <FieldLabel>Link Existing Person (optional)</FieldLabel>
                    <ManagedPersonSelect
                      value={createContactId}
                      onChange={setCreateContactId}
                      placeholder="Search people…"
                      searchPlaceholder="Search people…"
                      allowClear
                    />
                    <FieldDescription>
                      Optional. Link this login account to an existing person
                      in the directory.
                    </FieldDescription>
                  </Field>
                  {createSelectedContact && (
                    <ContactPreview contact={createSelectedContact} />
                  )}
                  {createConflictingRow && (
                    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        This person is already linked to{" "}
                        {createConflictingRow.loginEmail}. Linking them here
                        too may create a duplicate identity.
                      </span>
                    </div>
                  )}
                </FieldSet>

                <FieldSeparator />

                <FieldSet>
                  <FieldLegend>Platform Access</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor="create-role">Platform Role</FieldLabel>
                    <Select
                      value={createRole}
                      onValueChange={(v) => setCreateRole(v as UserRole)}
                    >
                      <SelectTrigger id="create-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Platform authorization only — the database&rsquo;s
                      current nine roles, shown as-is. This is an interim
                      set, not the final product role model.
                    </FieldDescription>
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="create-active-toggle">Active</FieldLabel>
                    <Switch
                      id="create-active-toggle"
                      checked={createActive}
                      onCheckedChange={setCreateActive}
                    />
                  </Field>
                  <FieldDescription>{ACTIVE_FIELD_DESCRIPTION}</FieldDescription>
                </FieldSet>
              </FieldGroup>
            </TabsContent>

            <TabsContent value="link" className="pt-4">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend>Account</FieldLegend>
                  {accountsWithoutProfile === null ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Loading existing login accounts…
                    </div>
                  ) : accountsError ? (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{accountsError}</span>
                    </div>
                  ) : noEligibleAccounts ? (
                    <EmptyState
                      icon={UserX}
                      title="No existing login accounts available to link"
                      description="All existing login accounts already have platform profiles. To create a new login account, use the Create New Account tab."
                    />
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="auth-account">
                        Select Login Account (no platform profile yet)
                      </FieldLabel>
                      <Select value={authUserId} onValueChange={setAuthUserId}>
                        <SelectTrigger id="auth-account">
                          <SelectValue placeholder="Select a login account…" />
                        </SelectTrigger>
                        <SelectContent>
                          {accountsWithoutProfile.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Accounts already covered by a platform profile are
                        not listed here — this is not the same as whether
                        that profile has a Person linked.
                      </FieldDescription>
                    </Field>
                  )}
                </FieldSet>

                {!noEligibleAccounts && (
                  <>
                    <FieldSeparator />

                    <FieldSet>
                      <FieldLegend>Person</FieldLegend>
                      <Field>
                        <FieldLabel>{personFieldLabel}</FieldLabel>
                        <ManagedPersonSelect
                          value={contactId}
                          onChange={setContactId}
                          placeholder="Search people…"
                          searchPlaceholder="Search people…"
                          allowClear={false}
                          clearable
                        />
                        <FieldDescription>
                          Select an existing person first. Create a new
                          contact only if the person does not already exist.
                        </FieldDescription>
                      </Field>
                      {selectedContact && (
                        <ContactPreview contact={selectedContact} />
                      )}
                      {conflictingRow && (
                        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            This person is already linked to{" "}
                            {conflictingRow.loginEmail}. Linking them here
                            too may create a duplicate identity.
                          </span>
                        </div>
                      )}
                    </FieldSet>

                    <FieldSeparator />

                    <FieldSet>
                      <FieldLegend>Platform Access</FieldLegend>
                      <Field>
                        <FieldLabel htmlFor="link-platform-role">
                          Platform Role
                        </FieldLabel>
                        <Select
                          value={role}
                          onValueChange={(v) => setRole(v as UserRole)}
                        >
                          <SelectTrigger id="link-platform-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          Platform authorization only — the database&rsquo;s
                          current nine roles, shown as-is. This is an
                          interim set, not the final product role model.
                        </FieldDescription>
                      </Field>
                    </FieldSet>
                  </>
                )}
              </FieldGroup>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {noEligibleAccounts ? "Close" : "Cancel"}
          </Button>
          {mode === "edit" && (
            <Button onClick={handleSaveClick} disabled={!canSave}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save Changes
            </Button>
          )}
          {mode === "add" && addTab === "create" && (
            <Button onClick={handleCreateAccount} disabled={!canCreate}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              Create User
            </Button>
          )}
          {mode === "add" && addTab === "link" && !noEligibleAccounts && (
            <Button onClick={handleSaveClick} disabled={!canSave}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              Link User
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={personChangeConfirmOpen}
        onOpenChange={(o) => {
          setPersonChangeConfirmOpen(o);
          if (!o && !personChangeConfirmed.current) {
            // Cancelled (or dismissed) without confirming — the write never
            // happened, and the picker's pending selection is dropped too.
            setContactId(originalContactId);
          }
          personChangeConfirmed.current = false;
        }}
        title="Change linked person?"
        description={changeLinkedPersonDescription(
          originalContact?.name,
          selectedContact?.name
        )}
        confirmLabel="Change Linked Person"
        onConfirm={async () => {
          personChangeConfirmed.current = true;
          await performSave();
        }}
      />

      <ConfirmDialog
        open={unlinkConfirmOpen}
        onOpenChange={setUnlinkConfirmOpen}
        title="Unlink this person?"
        description={UNLINK_PERSON_DESCRIPTION}
        confirmLabel="Unlink Person"
        destructive
        onConfirm={handleUnlink}
      />
    </Dialog>
  );
}
