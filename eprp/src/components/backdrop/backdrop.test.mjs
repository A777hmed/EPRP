import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Background illustrations — source contract.
 *
 * The backdrop is decoration, so what matters is where it is NOT: never in
 * front of content, never clickable, never printed, never behind dense
 * working surfaces. These tests read the source and the stylesheet; they do
 * not render anything, so the visual result still needs the browser review.
 */

const src = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(src, path), "utf8");
const css = read("app/globals.css");
const layer = read("components/backdrop/backdrop.tsx");
const artDir = "components/backdrop/art";
const artFiles = readdirSync(join(src, artDir)).filter((name) => name.endsWith(".tsx"));
const TONES = ["ink", "blue", "sky", "warm", "sand"];

/** The rule block for an exact selector, e.g. `.epr-backdrop {`. */
function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `globals.css has no "${selector}" rule`);
  return css.slice(start, css.indexOf("}", start));
}

/** Every .ts/.tsx file under src, as a path relative to src with "/" separators. */
function sourceFiles(dir = src) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [relative(src, full).split(sep).join("/")] : [];
  });
}

test("the layer is decorative: hidden from assistive technology and from print", () => {
  assert.match(layer, /<div\s+aria-hidden="true"/);
  assert.match(layer, /<svg[\s\S]*?focusable="false"[\s\S]*?aria-hidden="true"/);
  assert.match(layer, /"epr-backdrop print:hidden"/);
});

test("the layer sits behind its region and never takes a click or overflows", () => {
  const rule = block(".epr-backdrop");
  assert.match(rule, /position: absolute/);
  assert.match(rule, /z-index: -1/);
  assert.match(rule, /pointer-events: none/);
  assert.match(rule, /overflow: hidden/);
  assert.match(block(".epr-backdrop-region"), /isolation: isolate/);
});

test("a band is placed by its header's own width and kept off the description", () => {
  // The region is the size container the placement queries — the viewport is
  // a poor guide once the project sidebars take a third of a laptop screen.
  assert.match(block(".epr-backdrop-region"), /container: bd-region \/ inline-size/);
  // Corner (a narrow band, and every `corner` layout): the art ends where the
  // description starts.
  assert.match(
    css,
    /\.epr-backdrop:is\(\[data-backdrop-layout="band"\], \[data-backdrop-layout="corner"\]\) \.epr-backdrop-art \{[^}]*height: calc\(var\(--bd-bleed-top\) \+ var\(--bd-head\)\)/
  );
  // Beside (wide header): the art's box starts after the text column. Only a
  // band moves there — a `corner` layout never does.
  const beside = /@container bd-region \(min-width: 1000px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(beside, "globals.css has the wide-header placement");
  assert.match(beside[1], /width: calc\(100% - var\(--bd-clear\)\)/);
  assert.doesNotMatch(beside[1], /corner/);
  // The Dashboard intro tunes both to its own title block.
  assert.match(block('.dash-intro > .epr-backdrop[data-backdrop-layout="band"]'), /--bd-head: [\d.]+px;[^}]*--bd-clear: [\d.]+px;/);
  // Readability is protected by placement and local fades, never by dimming
  // the whole layer below the agreed strength range.
  assert.doesNotMatch(css, /opacity: calc\(var\(--bd-strength\)/);
});

test("print and forced-colours mode remove the layer", () => {
  assert.match(css, /@media print \{\s*\.epr-backdrop \{ display: none !important; \}/);
  assert.match(css, /@media \(forced-colors: active\) \{\s*\.epr-backdrop \{ display: none; \}/);
});

test("strength stays in the agreed range: light 10–16 %, dark 12–18 %", () => {
  // The token block is the one whose first declaration is --bd-ink.
  const tokens = (scope) => {
    const match = new RegExp(`${scope.replace(".", "\\.")} \\{\\s*--bd-ink[^}]*\\}`).exec(css);
    assert.ok(match, `globals.css has the ${scope} backdrop token block`);
    return match[0];
  };
  const value = (scope, step) => {
    const match = new RegExp(`--bd-strength-${step}: ([\\d.]+);`).exec(tokens(scope));
    assert.ok(match, `${scope} defines --bd-strength-${step}`);
    return Number(match[1]);
  };
  for (const step of ["subtle", "standard", "strong"]) {
    const light = value(":root", step);
    const dark = value(".dark", step);
    assert.ok(light >= 0.1 && light <= 0.16, `light ${step} = ${light}`);
    assert.ok(dark >= 0.12 && dark <= 0.18, `dark ${step} = ${dark}`);
  }
  // A first-run panel may be a little clearer — the illustration is the content.
  assert.ok(value(":root", "feature") <= 0.22);
  assert.ok(value(".dark", "feature") <= 0.24);
});

test("the art carries no text, no logo and no colour of its own", () => {
  for (const name of artFiles) {
    const art = read(`${artDir}/${name}`);
    assert.doesNotMatch(art, /<(text|image|foreignObject)\b/, `${name} embeds text or an image`);
    assert.doesNotMatch(art, /#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i, `${name} hardcodes a colour`);
    assert.doesNotMatch(art, /\s(fill|stroke|style)=/, `${name} colours a shape directly`);
  }
});

test("every tone class the art uses is themed by the stylesheet", () => {
  const used = new Set();
  for (const name of artFiles) {
    for (const [cls] of read(`${artDir}/${name}`).matchAll(/\bbd-[a-z]+(?:-[a-z]+)*\b/g)) used.add(cls);
  }
  for (const tone of TONES) {
    used.add(`bd-${tone}`);
    used.add(`bd-limb-${tone}`);
  }
  for (const cls of used) {
    assert.ok(css.includes(`.epr-backdrop .${cls} `) || css.includes(`.epr-backdrop .${cls},`), `.${cls} is not styled`);
  }
});

test("only the approved review surfaces use the backdrop", () => {
  const importers = sourceFiles()
    .filter((path) => !path.startsWith("components/backdrop/"))
    .filter((path) => read(path).includes('from "@/components/backdrop"'))
    .sort();
  assert.deepEqual(importers, [
    "app/design-system/page.tsx",
    "components/shared/empty-state.tsx",
    "features/calendar/calendar-workspace.tsx",
    "features/dashboard/dashboard-view.tsx",
    "features/executive-reports/executive-register.tsx",
    "features/monthly-reports/monthly-list-view.tsx",
    "features/projects/components/projects-view.tsx",
    "features/projects/components/sections/project-section-view.tsx",
    "features/projects/components/setup/project-setup-view.tsx",
    "features/weekly-reports/components/weekly-reports-view.tsx",
  ]);

  // First-run empty states that opt in through EmptyState's `backdrop` prop.
  const panels = sourceFiles()
    .filter((path) => !path.startsWith("components/backdrop/"))
    .filter((path) => /\sbackdrop=/.test(read(path)))
    .sort();
  assert.deepEqual(panels, [
    "app/design-system/page.tsx",
    "features/projects/components/sections/project-reporting-workspace.tsx",
    "features/weekly-reports/components/weekly-reports-view.tsx",
  ]);
});

test("no report document, preview, print or workspace editor can reach it", () => {
  const reportSurfaces = sourceFiles().filter((path) =>
    /^features\/(weekly-reports|monthly-reports|executive-reports|exports)\//.test(path)
    && /(document|preview|print|workspace|sheet|edit)/.test(path)
  );
  assert.ok(reportSurfaces.length > 0, "found the report surfaces to check");
  for (const path of reportSurfaces) {
    const source = read(path);
    assert.doesNotMatch(source, /@\/components\/backdrop/, `${path} imports the backdrop`);
    assert.doesNotMatch(source, /\sbackdrop=/, `${path} passes a backdrop`);
  }
});

test("the Dashboard backdrop covers only the intro, ending above the KPI strip", () => {
  const view = read("features/dashboard/dashboard-view.tsx");
  const open = view.indexOf('<BackdropRegion variant="refinery"');
  const close = view.indexOf("</BackdropRegion>", open);
  const intro = view.slice(open, close);
  assert.ok(open !== -1 && close !== -1);
  assert.match(intro, /className="dash-top"/);
  assert.match(intro, /className="dash-shortcuts"/);
  assert.doesNotMatch(intro, /KpiStrip|dash-kpis|dash-row/);
  assert.ok(close < view.indexOf("<KpiStrip"), "the region closes before the KPI strip");
});

test("project sections opt in by header only — the org chart body stays clean", () => {
  const view = read("features/projects/components/sections/project-section-view.tsx");
  const map = /SECTION_BACKDROP[^=]*=\s*\{([\s\S]*?)\};/.exec(view);
  assert.ok(map);
  assert.deepEqual(
    [...map[1].matchAll(/"([a-z-]+)":/g)].map((m) => m[1]),
    ["organization-chart"]
  );
  assert.match(view, /<BackdropRegion variant=\{backdrop\} strength="subtle">\s*\{header\}\s*<\/BackdropRegion>/);
  for (const path of [
    "features/projects/components/sections/organization-chart-section.tsx",
    "features/projects/components/people-chart/people-org-chart.tsx",
    "features/projects/components/people-chart/people-chart-tree.tsx",
  ]) {
    assert.doesNotMatch(read(path), /backdrop/i, `${path} must not carry a backdrop`);
  }
});

test("Projects, Monthly, Executive and Calendar carry a backdrop in the header only", () => {
  /** The one BackdropRegion in a file: its opening tag and what it wraps. */
  const regionIn = (path) => {
    const view = read(path);
    const open = view.indexOf("<BackdropRegion");
    const close = view.indexOf("</BackdropRegion>", open);
    assert.ok(open !== -1 && close !== -1, `${path} has a BackdropRegion`);
    assert.equal(view.indexOf("<BackdropRegion", open + 1), -1, `${path} has one region`);
    return { view, close, tag: view.slice(open, view.indexOf(">", open) + 1), body: view.slice(open, close) };
  };
  const surfaces = [
    // [path, the header it wraps, what must come after it, opening tag]
    ["features/projects/components/projects-view.tsx", "<PageHeader", 'aria-label="Project statistics"',
      '<BackdropRegion variant="refinery" strength="subtle">'],
    ["features/monthly-reports/monthly-list-view.tsx", 'className="monthly-list-header"', 'className="monthly-counter-row"',
      '<BackdropRegion variant="collaboration" layout="corner" className="report-register-intro">'],
    ["features/executive-reports/executive-register.tsx", 'className="monthly-list-header"', 'className="monthly-list-toolbar"',
      '<BackdropRegion variant="review" strength="subtle" layout="corner" className="report-register-intro">'],
    ["features/calendar/calendar-workspace.tsx", 'className="cal-header"', 'className="cal-toolbar"',
      '<BackdropRegion variant="planning" layout="corner" className="cal-intro">'],
  ];
  for (const [path, header, after, tag] of surfaces) {
    const region = regionIn(path);
    assert.equal(region.tag, tag, `${path} uses the agreed variant, strength and layout`);
    assert.ok(region.body.includes(header), `${path} wraps its header`);
    assert.ok(region.close < region.view.indexOf(after), `${path} closes the region before ${after}`);
    assert.doesNotMatch(region.body, /<table|<select|<input|StatCard|EmptyState|cal-body|cal-surface/, `${path} wraps only the header`);
  }

  // Monthly matches Weekly (both the default `standard`); Executive is quieter.
  const weekly = regionIn("features/weekly-reports/components/weekly-reports-view.tsx").tag;
  assert.equal(weekly, '<BackdropRegion variant="collaboration">');
  assert.doesNotMatch(surfaces[1][3], /strength=/);
  assert.match(surfaces[2][3], /strength="subtle"/);
});

test("a project's Weekly, Monthly and Executive first-run panels are one family", () => {
  const view = read("features/projects/components/sections/project-reporting-workspace.tsx");
  /** The source of one tab component, up to the next top-level function. */
  const tabSource = (name) => {
    const start = view.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} exists`);
    const next = view.indexOf("\nfunction ", start + 1);
    const nextExport = view.indexOf("\nexport ", start + 1);
    const end = [next, nextExport].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? view.length;
    return view.slice(start, end);
  };
  const tabs = {
    WeeklyTab: { backdrop: "collaboration", icon: "CalendarDays", label: "{WEEKLY_CREATE_LABEL}" },
    MonthlyTab: { backdrop: "collaboration", icon: "CalendarRange", label: "{MONTHLY_CREATE_LABEL}" },
    // The derived Executive view: the Reporting family's management-review scene.
    ExecutiveTab: { backdrop: "review", icon: "Presentation", label: '"Create Monthly Report"' },
  };
  for (const [name, expected] of Object.entries(tabs)) {
    const source = tabSource(name);
    assert.match(source, /<EmptyState[\s\S]*?size="lg"/, `${name} uses the large first-run panel`);
    assert.match(source, /className=\{FIRST_RUN_PANEL\}/, `${name} occludes with its card`);
    assert.match(source, new RegExp(`backdrop="${expected.backdrop}"`), `${name} uses ${expected.backdrop}`);
    assert.match(source, new RegExp(`icon=\\{${expected.icon}\\}`), `${name} uses the platform icon`);
    assert.ok(source.includes(`label=${expected.label}`), `${name} CTA label`);
  }

  // The Executive CTA opens the Monthly create form and is worded "Create
  // Monthly Report" to name that prerequisite; the Monthly tab keeps "New
  // Monthly Report" for the same link.
  assert.match(tabSource("ExecutiveTab"), /href=\{`\/projects\/\$\{projectId\}\/reports\/monthly\/new`\}/);
  assert.match(view, /const MONTHLY_CREATE_LABEL = "New Monthly Report";/);
  assert.equal(view.split('"Create Monthly Report"').length - 1, 1, "only the Executive CTA says Create Monthly Report");
  // FIRST_RUN_PANEL points the art's occluding paper at the card it sits on.
  assert.match(view, /const FIRST_RUN_PANEL = "\[--bd-paper:var\(--card\)\]";/);
});
