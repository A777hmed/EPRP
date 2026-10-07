import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormControl, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createProjectDraftSchema, createProjectFinalSchema, emptyProjectFormValues, formValuesToProjectInput, projectToFormValues } from "./schemas/project-form.ts";
import { computeSectionStatuses } from "./form-meta.ts";

registerHooks({ load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const { ProjectPartiesFields, touchSubcontractorFields } = await import("./components/project-parties-fields.tsx");
const { RhfField } = await import("./components/form-field.tsx");
function Fields({ rows = [], ...props }) {
  const form = useForm({ defaultValues: { ...emptyProjectFormValues(), subcontractors: rows } });
  return React.createElement(ProjectPartiesFields, {
    control: form.control,
    ownerFields: React.createElement("label", null, "Owner / Client", React.createElement("input", { name: "clientId", defaultValue: "client-a", required: true })),
    ...props,
  });
}
const markup = (props = {}) => renderToStaticMarkup(React.createElement(Fields, props));

const existingProjectValues = (family) => projectToFormValues({
  ...formValuesToProjectInput({
    ...emptyProjectFormValues(), name: "Existing project", code: "PARTY-01",
    structureFamily: family, projectTypeId: family === "other" ? "category" : "",
    clientId: "client-a", description: "Existing project with no subcontractors",
    plannedStartDate: "2026-01-01", plannedFinishDate: "2026-12-31",
    currentPhaseId: "phase", site: "Site", projectManagerId: "pm",
    projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
  }),
  id: "existing-project", createdAt: "v1", updatedAt: "v1",
  parties: [{ id: "eprom-id", kind: "eprom", sortOrder: 0 }, { id: "owner-id", kind: "owner", sortOrder: 1 }],
});

// Run the actual field-array handlers against RHF's form control. Static HTML
// supplies the visible assertions; captured effects also exercise initialization.
function InteractionFields({ control, capture }) {
  const tree = ProjectPartiesFields({ control, ownerFields: React.createElement("label", null, "Owner / Client") });
  capture(tree);
  return tree;
}
function buttonsIn(tree) {
  if (!React.isValidElement(tree)) return [];
  return [ ...(typeof tree.props.onClick === "function" ? [tree.props] : []),
    ...React.Children.toArray(tree.props.children).flatMap(buttonsIn) ];
}

for (const family of ["psm", "other"]) {
  test(`${family}: existing fixed parties initialize empty; Add creates one row; removing it restores valid completion`, (t) => {
    const values = existingProjectValues(family);
    const schema = createProjectFinalSchema([], { requireStructureFamily: true });
    const form = createFormControl({ defaultValues: values });
    const unsubscribe = form.subscribe({ formState: { values: true }, callback() {} });
    t.after(unsubscribe);
    const effects = [];
    t.mock.method(React, "useEffect", (effect) => { effects.push(effect); });
    let tree;
    const render = () => {
      effects.length = 0;
      const html = renderToStaticMarkup(React.createElement(InteractionFields, {
        control: form.control, capture: (next) => { tree = next; },
      }));
      for (const effect of effects) effect();
      return html;
    };
    const assertEmptyAndComplete = (html) => {
      assert.deepEqual(form.getValues("subcontractors"), []);
      assert.match(html, /No subcontractors configured/);
      assert.doesNotMatch(html, /name="subcontractors\.0\.name"|Remove subcontractor 1/);
      assert.equal(schema.safeParse(form.getValues()).success, true);
      assert.deepEqual(computeSectionStatuses(form.getValues(), schema, {})[1], { kind: "complete", missingCount: 0 });
    };
    assertEmptyAndComplete(render());
    assertEmptyAndComplete(render());
    const [add] = buttonsIn(tree);
    add.onClick();
    const added = render();
    // A new row starts blank with an explicit, unselected Engagement Status (no default).
    assert.deepEqual(form.getValues("subcontractors"), [{ name: "", shortName: "", scope: "", contractReference: "", engagementStatus: "" }]);
    assert.equal((added.match(/<input[^>]*name="subcontractors\.\d+\.name"/g) ?? []).length, 1);
    assert.match(added, /name="subcontractors\.0\.name"[^>]*value=""/);
    assert.match(added, /Select engagement status/);
    assert.match(added, /New subcontractor/);
    assert.doesNotMatch(added, />Planned<|Needs completion/);
    const issues = schema.safeParse(form.getValues()).error.issues.map((issue) => issue.path.join("."));
    assert.deepEqual(issues.filter((path) => path.startsWith("subcontractors")).sort(),
      ["subcontractors.0.engagementStatus", "subcontractors.0.name", "subcontractors.0.scope"]);
    assert.match(added, /aria-label="Remove subcontractor 1"/);
    assert.equal(schema.safeParse(form.getValues()).success, false);
    const remove = buttonsIn(tree).find((button) => button["aria-label"] === "Remove subcontractor 1");
    remove.onClick();
    assertEmptyAndComplete(render());
  });
}

test("Project Parties mounts once, required EPROM/Owner and optional empty subcontractors are clear", () => {
  const html = markup();
  assert.equal((html.match(/id="project-parties-heading"/g) ?? []).length, 1);
  assert.match(html, /EPROM/);
  assert.match(html, /Required · Fixed project party · Service provider/);
  assert.match(html, /Owner \/ Client/);
  assert.match(html, /Subcontractors[\s\S]*?Optional/);
  assert.match(html, /Add Subcontractor/);
  assert.match(html, /complete Project Information without any/);
  assert.doesNotMatch(html, /Does this project have subcontractors/);
});

test("multiple subcontractor fields and remove controls render alongside one Owner selector", () => {
  const html = markup({ rows: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] });
  assert.equal((html.match(/name="clientId"/g) ?? []).length, 1);
  assert.match(html, /value="Alpha"/);
  assert.match(html, /value="Beta"/);
  assert.match(html, /aria-label="Remove subcontractor 1"/);
  assert.match(html, /aria-label="Remove subcontractor 2"/);
  assert.match(html, /take effect when Project Information is saved/);
});

test("saving and unavailable storage disable subcontractor edits without hiding required parties", () => {
  for (const props of [{ disabled: true }, { supported: false }]) {
    const html = markup({ rows: [{ id: "a", name: "Alpha" }], ...props });
    // Add, Remove and the Engagement Status trigger.
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 3);
    assert.match(html, /<input[^>]*disabled=""[^>]*value="Alpha"/);
    assert.match(html, /EPROM/);
    assert.match(html, /name="clientId"/);
  }
});

test("Information reuses the Client selector and adopts confirmed party UUIDs after draft/final saves", () => {
  const form = readFileSync(new URL("./components/project-form.tsx", import.meta.url), "utf8");
  assert.equal((form.match(/<ProjectPartiesFields\b/g) ?? []).length, 1);
  assert.equal((form.match(/name="clientId" label="Owner \/ Client" required kind="client"/g) ?? []).length, 1);
  assert.match(form, /const saved = await onSubmit\(values\);[\s\S]*?setValue\("subcontractors", projectToFormValues\(saved\).subcontractors\)/);
  assert.match(form, /const saved = await onSaveDraft\(values\);[\s\S]*?form.reset\(saved \? \{ \.\.\.values, subcontractors: projectToFormValues\(saved\).subcontractors \}/);
  assert.match(form, /disabled=\{formState.isSubmitting \|\| savingDraft \|\| savingConfirmed\}/);
  const fields = readFileSync(new URL("./components/project-parties-fields.tsx", import.meta.url), "utf8");
  assert.match(fields, /key=\{row.id\}/);
  assert.doesNotMatch(fields, /contacts.organization|Math.random|Date.now/);
});

test("2C.3B card: heading prefers Short Name, falls back to Registered Company Name; status badge shows the chosen value", () => {
  const html = markup({ rows: [
    { id: "a", name: "Alpha Contracting Company", shortName: "ACC", scope: "HVAC", contractReference: "SC-1", engagementStatus: "active" },
    { id: "b", name: "Beta Engineering", shortName: "", scope: "Civil", contractReference: "", engagementStatus: "suspended" },
  ] });
  const headings = [...html.matchAll(/<h5[^>]*>([^<]*)<\/h5>/g)].map((match) => match[1]);
  assert.deepEqual(headings, ["ACC", "Beta Engineering"]);
  assert.match(html, /Subcontractor 1/);
  assert.match(html, /Subcontractors \(2\)/);
  assert.match(html, />Active</);
  assert.match(html, />Suspended</);
  assert.doesNotMatch(html, /Needs completion/);
  assert.match(html, /name="subcontractors\.0\.scope"[^>]*>HVAC<\/textarea>/);
  assert.match(html, /value="SC-1"/);
});

test("2C.3B card: required and optional fields are clearly distinguished", () => {
  const html = markup({ rows: [{ id: "a", name: "Alpha", shortName: "", scope: "HVAC", contractReference: "", engagementStatus: "planned" }] });
  const label = (text) => html.slice(html.indexOf(text), html.indexOf("</label>", html.indexOf(text)));
  for (const required of ["Registered Company Name", "Scope / Package", "Engagement Status"]) {
    assert.match(label(required), /text-destructive[^>]*>\*</, required);
    assert.doesNotMatch(label(required), /Optional/, required);
  }
  for (const optional of ["Short Name / Acronym", "Subcontract / Contract Reference"]) {
    assert.match(label(optional), /Optional/, optional);
    assert.doesNotMatch(label(optional), /text-destructive/, optional);
  }
  assert.match(html, /Required field/);
  for (const [field, max] of [["name", 140], ["shortName", 40], ["scope", 250], ["contractReference", 100]]) {
    assert.match(html, new RegExp(`maxLength="${max}"[^>]*name="subcontractors\\.0\\.${field}"|name="subcontractors\\.0\\.${field}"[^>]*maxLength="${max}"`), field);
  }
  // People belong to Project Responsibility, not Project Parties.
  assert.doesNotMatch(html, /contact person|Contact Name|Representative|Email|Phone/i);
});

test("2C.3B card: a saved pre-2C.3B row without scope/status shows Needs completion and stays unselected", () => {
  const html = markup({ rows: [{ id: "legacy", name: "Legacy Works", shortName: "", scope: "", contractReference: "", engagementStatus: "" }] });
  assert.match(html, /Needs completion/);
  assert.match(html, /Select engagement status/);
  assert.match(html, /<h5[^>]*>Legacy Works<\/h5>/);
  assert.doesNotMatch(html, />Planned</);
});

/* ---- 2C.3B validation timing: display only; the schema, domain and database rules are unchanged ---- */

// The real form's validation setup: the final-schema resolver in onBlur mode.
function timingHarness(t, family) {
  const schema = createProjectFinalSchema([], { requireStructureFamily: true });
  const form = createFormControl({ defaultValues: existingProjectValues(family), resolver: zodResolver(schema), mode: "onBlur" });
  t.after(form.subscribe({ formState: { values: true, errors: true, touchedFields: true }, callback() {} }));
  const effects = [];
  t.mock.method(React, "useEffect", (effect) => { effects.push(effect); });
  let tree;
  const render = () => {
    effects.length = 0;
    const html = renderToStaticMarkup(React.createElement(InteractionFields, { control: form.control, capture: (next) => { tree = next; } }));
    for (const effect of effects) effect();
    return renderToStaticMarkup(React.createElement(InteractionFields, { control: form.control, capture: (next) => { tree = next; } })) || html;
  };
  const click = (label) => buttonsIn(tree).find((button) => label ? button["aria-label"] === label : !button["aria-label"]).onClick();
  const blur = (name) => form.control.register(name).onBlur({ target: { name, value: form.getValues(name) }, type: "blur" });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { form, render, click, blur, settle };
}
// Exactly one field wrapper: from its opening <div> (which carries data-invalid
// before data-field-name) up to the opening <div> of the next field.
const fieldMarkup = (html, name) => {
  const marker = html.indexOf(`data-field-name="${name}"`);
  assert.notEqual(marker, -1, name);
  const next = html.indexOf("data-field-name=", marker + 1);
  return html.slice(html.lastIndexOf("<div", marker), next === -1 ? undefined : html.lastIndexOf("<div", next));
};
const shownError = (html, name) => /aria-invalid="true"|role="alert"|data-invalid="true"/.test(fieldMarkup(html, name));
const REQUIRED = ["name", "scope", "engagementStatus"];

for (const family of ["psm", "other"]) {
  test(`${family}: a newly added card is neutral even when its errors already exist; required markers show at once`, async (t) => {
    const { form, render, click, settle } = timingHarness(t, family);
    render();
    click();
    render();
    // Force whole-form validation: errors now exist for every required field.
    await form.trigger();
    await settle();
    const errors = form.control._formState.errors.subcontractors?.[0] ?? {};
    assert.deepEqual(Object.keys(errors).sort(), ["engagementStatus", "name", "scope"]);
    const html = render();
    for (const field of ["name", "shortName", "scope", "contractReference", "engagementStatus"]) {
      assert.equal(shownError(html, `subcontractors.0.${field}`), false, field);
    }
    assert.doesNotMatch(html, /Enter the registered company name|Enter the scope|Select an engagement status<\/p>|role="alert"/);
    for (const field of REQUIRED) {
      assert.match(fieldMarkup(html, `subcontractors.0.${field}`), /text-destructive" aria-hidden="true">\*</, field);
    }
    assert.match(html, /Select engagement status/);
  });

  test(`${family}: an error shows only for the field that was left while invalid`, async (t) => {
    const { form, render, click, blur, settle } = timingHarness(t, family);
    render();
    click();
    render();
    await blur("subcontractors.0.name");
    await settle();
    let html = render();
    assert.equal(shownError(html, "subcontractors.0.name"), true);
    assert.match(fieldMarkup(html, "subcontractors.0.name"), /Enter the registered company name or remove this subcontractor/);
    assert.equal(shownError(html, "subcontractors.0.scope"), false);
    assert.equal(shownError(html, "subcontractors.0.engagementStatus"), false);
    // Fixing the field and leaving it again clears the error.
    form.setValue("subcontractors.0.name", "Alpha Contracting");
    await blur("subcontractors.0.name");
    await settle();
    html = render();
    assert.equal(shownError(html, "subcontractors.0.name"), false);
  });

  test(`${family}: a save attempt reveals every error of current rows and blocks persistence; later rows stay neutral`, async (t) => {
    const { form, render, click, settle } = timingHarness(t, family);
    render();
    click();
    render();
    let saved = false;
    // Mirrors ProjectForm: the refused submit's onInvalid touches current rows.
    await form.handleSubmit(() => { saved = true; }, () => touchSubcontractorFields(form))();
    await settle();
    assert.equal(saved, false);
    let html = render();
    for (const field of REQUIRED) assert.equal(shownError(html, `subcontractors.0.${field}`), true, field);
    assert.match(html, /Enter the scope \/ package/);
    assert.match(html, /Select an engagement status<\/p>|Select an engagement status<\/div>|role="alert"[^>]*>Select an engagement status/);
    // Optional fields have nothing to report.
    assert.equal(shownError(html, "subcontractors.0.shortName"), false);
    // A row added after the attempt starts neutral, even though the form is now submitted.
    click();
    render();
    await form.trigger();
    await settle();
    html = render();
    for (const field of REQUIRED) {
      assert.equal(shownError(html, `subcontractors.0.${field}`), true, `row 1 ${field}`);
      assert.equal(shownError(html, `subcontractors.1.${field}`), false, `row 2 ${field}`);
    }
    // Touching never changes values or dirties the form.
    assert.deepEqual(form.getValues("subcontractors")[0], { name: "", shortName: "", scope: "", contractReference: "", engagementStatus: "" });
  });

  test(`${family}: Save Draft reveals the draft schema's subcontractor errors`, async (t) => {
    const { form, render, click } = timingHarness(t, family);
    render();
    click();
    render();
    // Mirrors handleSaveDraft: touch current rows, then set the draft schema's issues.
    touchSubcontractorFields(form);
    const parsed = createProjectDraftSchema([]).safeParse(form.getValues());
    assert.equal(parsed.success, false);
    for (const issue of parsed.error.issues) form.setError(issue.path.join("."), { type: "manual", message: issue.message });
    const html = render();
    for (const field of REQUIRED) assert.equal(shownError(html, `subcontractors.0.${field}`), true, field);
  });

  test(`${family}: duplicate company names still show once the duplicate field is left`, async (t) => {
    const { form, render, click, blur, settle } = timingHarness(t, family);
    render();
    click();
    click();
    render();
    form.setValue("subcontractors.0", { name: "Alpha Ltd", shortName: "", scope: "Civil", contractReference: "", engagementStatus: "active" });
    form.setValue("subcontractors.1", { name: "  alpha LTD ", shortName: "", scope: "MEP", contractReference: "", engagementStatus: "planned" });
    let html = render();
    assert.equal(shownError(html, "subcontractors.1.name"), false);
    await blur("subcontractors.1.name");
    await settle();
    html = render();
    assert.equal(shownError(html, "subcontractors.1.name"), true);
    assert.match(fieldMarkup(html, "subcontractors.1.name"), /already listed as a subcontractor on this project/);
    assert.equal(shownError(html, "subcontractors.0.name"), false);
  });

  test(`${family}: removing a row clears its errors and touched state; zero rows is valid again`, async (t) => {
    const { form, render, click, settle } = timingHarness(t, family);
    const schema = createProjectFinalSchema([], { requireStructureFamily: true });
    render();
    click();
    render();
    await form.handleSubmit(() => {}, () => touchSubcontractorFields(form))();
    await settle();
    assert.ok(form.control._formState.errors.subcontractors);
    render();
    click("Remove subcontractor 1");
    await settle();
    const html = render();
    assert.equal(form.control._formState.errors.subcontractors, undefined);
    assert.equal(form.control._formState.touchedFields.subcontractors?.length ?? 0, 0);
    assert.doesNotMatch(html, /aria-invalid="true"|role="alert"/);
    assert.match(html, /No subcontractors configured/);
    assert.equal(schema.safeParse(form.getValues()).success, true);
    // A fresh row after removal starts neutral, not with the removed row's state.
    click();
    render();
    await form.trigger();
    await settle();
    const fresh = render();
    for (const field of REQUIRED) assert.equal(shownError(fresh, `subcontractors.0.${field}`), false, field);
  });
}

test("fields without a showError rule keep immediate error display (shared RhfField unchanged)", (t) => {
  const form = createFormControl({ defaultValues: emptyProjectFormValues() });
  t.after(form.subscribe({ formState: { errors: true }, callback() {} }));
  form.setError("name", { type: "manual", message: "Project name must be at least 5 characters" });
  const html = renderToStaticMarkup(React.createElement(RhfField, { control: form.control, name: "name", label: "Project Name", required: true },
    ({ field, controlProps }) => React.createElement("input", { ...controlProps, name: field.name, defaultValue: field.value })));
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /Project name must be at least 5 characters/);
});

test("every save path touches subcontractor rows first; Engagement Status counts as left on close, not on open", () => {
  const form = readFileSync(new URL("./components/project-form.tsx", import.meta.url), "utf8");
  assert.match(form, /<form onSubmit=\{handleSubmit\(onValid, onInvalid\)\}/);
  assert.match(form, /const onInvalid: SubmitErrorHandler<ProjectFormValues> = \(rhfErrors\) => \{[\s\S]{0,200}?touchSubcontractorFields\(form\);/);
  assert.match(form, /const handleSaveDraft = async \(\) => \{\s*if \(!onSaveDraft\) return;\s*touchSubcontractorFields\(form\);[\s\S]*?draftSchema\.safeParse/);
  assert.equal((form.match(/handleSubmit\(/g) ?? []).length, 1);
  const fields = readFileSync(new URL("./components/project-parties-fields.tsx", import.meta.url), "utf8");
  assert.equal((fields.match(/showError=\{showWhenTouched\}/g) ?? []).length, 5);
  assert.match(fields, /onOpenChange=\{\(next\) => \{\s*open\.current = next;\s*if \(!next\) field\.onBlur\(\);/);
  assert.match(fields, /onBlur=\{\(\) => \{ if \(!open\.current\) field\.onBlur\(\); \}\}/);
  assert.match(fields, /setValue\(`subcontractors\.\$\{index\}\.\$\{key\}`, row\[key\] \?\? "", \{ shouldTouch: true \}\)/);
  assert.doesNotMatch(fields, /shouldDirty|shouldValidate/);
});
