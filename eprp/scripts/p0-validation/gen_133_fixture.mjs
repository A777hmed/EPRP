// Rewrites the GENERATED block of 133_runtime_13_12_snapshot_v2.sql from the
// real 13.12 orchestration (see src/features/projects/planning-publish/sql-fixture.mjs).
//
//   node --import ./src/features/notifications/test-runtime.mjs scripts/p0-validation/gen_133_fixture.mjs

import { readFileSync, writeFileSync } from "node:fs";

import { BEGIN, END, generatedFixtureSql } from "../../src/features/projects/planning-publish/sql-fixture.mjs";

const file = new URL("./133_runtime_13_12_snapshot_v2.sql", import.meta.url);
const text = readFileSync(file, "utf8").replaceAll("\r", "");
const start = text.indexOf(BEGIN);
const end = text.indexOf(END);
if (start < 0 || end < 0) throw new Error("GENERATED markers not found in the 133 suite.");
writeFileSync(file, text.slice(0, start) + generatedFixtureSql() + text.slice(end + END.length));
console.log("133 fixture block regenerated.");
