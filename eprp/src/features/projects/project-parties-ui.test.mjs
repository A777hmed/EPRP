import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormControl, useForm } from "react-hook-form";
import { createProjectFinalSchema, emptyProjectFormValues, formValuesToProjectInput, projectToFormValues } from "./schemas/project-form.ts";
import { computeSectionStatuses } from "./form-meta.ts";

registerHooks({ load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const { ProjectPartiesFields } = await import("./components/project-parties-fields.tsx");
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
    assert.deepEqual(form.getValues("subcontractors"), [{ name: "" }]);
    assert.equal((added.match(/<input[^>]*name="subcontractors\.\d+\.name"/g) ?? []).length, 1);
    assert.match(added, /name="subcontractors\.0\.name"[^>]*value=""/);
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
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 2);
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
