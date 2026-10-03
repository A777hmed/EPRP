import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { zodResolver } from "@hookform/resolvers/zod";
import { createFormControl, get } from "react-hook-form";

import { computeSectionStatuses } from "./form-meta.ts";
import {
  createProjectDraftSchema,
  createProjectFinalSchema,
  emptyProjectFormValues,
} from "./schemas/project-form.ts";

/*
 * Project Responsibility: choosing a person must re-validate the field.
 *
 * The project form validates on blur. A fixed role's editor is only mounted
 * while it is open, so a "required" error raised while the role was empty
 * could outlive the selection and keep Section 3 at "Has Errors". These tests
 * drive the real react-hook-form control and the real final schema, headless.
 */

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");

const SCHEMA_OPTIONS = { requireStructureFamily: true };
const finalSchema = createProjectFinalSchema([], SCHEMA_OPTIONS);
const draftSchema = createProjectDraftSchema([], SCHEMA_OPTIONS);

const REQUIRED_ROLES = [
  ["projectManagerId", "Select a project manager"],
  ["projectControlManagerId", "Select a project control manager"],
  ["reportingCoordinatorId", "Select a reporting coordinator"],
];

/** A new PSM project with only the identity fields entered. */
const newProjectValues = (overrides = {}) => ({
  ...emptyProjectFormValues(),
  structureFamily: "psm",
  name: "Plant Systems Integrity",
  code: "PSI-001",
  ...overrides,
});

/** The project form's own configuration: final-schema resolver, validate on blur. */
function projectForm(values = newProjectValues()) {
  const { control } = createFormControl({
    resolver: zodResolver(finalSchema),
    defaultValues: values,
    mode: "onBlur",
  });
  /** What a `Controller` hands its render prop as `field`. */
  const field = (name) => {
    const registered = control.register(name);
    return {
      onChange: (value) => registered.onChange({ target: { value, name }, type: "change" }),
      onBlur: () =>
        registered.onBlur({ target: { value: get(control._formValues, name), name }, type: "blur" }),
    };
  };
  const errors = () => control._formState.errors;
  const section3 = () => computeSectionStatuses(control._formValues, finalSchema, errors())[3];
  return { control, field, errors, section3 };
}

/** PersonField's selection handler: change, then blur, in the same tick. */
const selectPerson = (field, contactId) => Promise.all([field.onChange(contactId), field.onBlur()]);

test("an empty required role gets its required error on blur", async () => {
  for (const [name, message] of REQUIRED_ROLES) {
    const form = projectForm();
    await form.field(name).onBlur();
    assert.equal(form.errors()[name]?.message, message, name);
    assert.equal(form.section3().kind, "has-errors", name);
  }
});

test("the stale error this fixes: a change alone does not re-validate before the first submit", async () => {
  const form = projectForm();
  const field = form.field("reportingCoordinatorId");
  await field.onBlur();
  await field.onChange("contact-mohamed");
  assert.equal(get(form.control._formValues, "reportingCoordinatorId"), "contact-mohamed");
  assert.equal(form.errors().reportingCoordinatorId?.message, "Select a reporting coordinator");
});

test("selecting a person updates the value, re-validates at once and clears the stale error", async () => {
  const form = projectForm();
  const people = {
    projectManagerId: "contact-sara",
    projectControlManagerId: "contact-khaled",
    reportingCoordinatorId: "contact-mohamed",
  };

  // Opening each picker while the role is empty raises the required error.
  for (const [name] of REQUIRED_ROLES) await form.field(name).onBlur();
  assert.equal(form.section3().kind, "has-errors");

  for (const [name] of REQUIRED_ROLES) {
    await selectPerson(form.field(name), people[name]);
    assert.equal(get(form.control._formValues, name), people[name], name);
    assert.equal(form.errors()[name], undefined, name);
  }

  // All three required roles populated, the optional two unassigned.
  assert.equal(form.control._formValues.clientRepresentativeId, "");
  assert.equal(form.control._formValues.projectSponsorId, "");
  assert.deepEqual(form.section3(), { kind: "complete", missingCount: 0 });
});

test("a genuinely empty required role is still an error after the same handler runs", async () => {
  const form = projectForm(newProjectValues({ projectManagerId: "contact-sara" }));
  const field = form.field("projectManagerId");
  await selectPerson(field, "");
  assert.equal(form.errors().projectManagerId?.message, "Select a project manager");
  assert.equal(form.section3().kind, "has-errors");
});

test("optional roles raise nothing when assigned or cleared", async () => {
  const form = projectForm();
  for (const name of ["clientRepresentativeId", "projectSponsorId"]) {
    const field = form.field(name);
    await selectPerson(field, "contact-nour");
    assert.equal(form.errors()[name], undefined, name);
    await selectPerson(field, "");
    assert.equal(form.errors()[name], undefined, name);
  }
});

test("Save Draft rules are unchanged: responsibilities are not required for a draft", () => {
  assert.equal(draftSchema.safeParse(newProjectValues()).success, true);
  // The draft still needs its identity fields.
  const noCode = draftSchema.safeParse(newProjectValues({ code: "" }));
  assert.equal(noCode.success, false);
  assert.deepEqual(noCode.error.issues.map((issue) => issue.path.join(".")), ["code"]);
});

test("Create rules are unchanged: the three fixed roles are still required", () => {
  const empty = finalSchema.safeParse(newProjectValues());
  assert.equal(empty.success, false);
  const messages = new Map(empty.error.issues.map((issue) => [issue.path.join("."), issue.message]));
  for (const [name, message] of REQUIRED_ROLES) assert.equal(messages.get(name), message);
  assert.equal(messages.has("clientRepresentativeId"), false);
  assert.equal(messages.has("projectSponsorId"), false);

  const filled = finalSchema.safeParse(
    newProjectValues({
      projectManagerId: "contact-sara",
      projectControlManagerId: "contact-khaled",
      reportingCoordinatorId: "contact-mohamed",
    })
  );
  // Other sections are still incomplete; no responsibility issue remains.
  const remaining = new Set((filled.success ? [] : filled.error.issues).map((issue) => String(issue.path[0])));
  for (const name of [...REQUIRED_ROLES.map(([role]) => role), "clientRepresentativeId", "projectSponsorId", "additionalPositions"]) {
    assert.equal(remaining.has(name), false, name);
  }
});

test("PersonField re-validates on selection, and only PersonField changed", () => {
  const form = source("./components/project-form.tsx");
  const personField = form.slice(form.indexOf("function PersonField("), form.indexOf("function ", form.indexOf("function PersonField(") + 1));
  const change = personField.indexOf("field.onChange(value);");
  const blur = personField.indexOf("field.onBlur();");
  const notify = personField.indexOf("onValueChange?.(value, previousValue);");
  assert.ok(change > -1 && blur > change && notify > blur, "onChange, then onBlur, then onValueChange");
  // The picker's own blur is still wired, and the form still validates on blur.
  assert.match(personField, /onBlur=\{field\.onBlur\}/);
  assert.match(form, /mode: "onBlur",/);
  // The generic managed select field is out of scope and untouched.
  const managed = form.slice(form.indexOf("function ManagedSelectField("), form.indexOf("const ONBOARDING_MODE_OPTIONS"));
  assert.doesNotMatch(managed, /field\.onBlur\(\)/);
});
