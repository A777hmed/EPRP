import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarDaysBetween,
  dayNumber,
  earnedPercentAt,
  parseWorkingWeek,
  plannedPercentAt,
  weeklyGrid,
  WorkingCalendar,
} from "./index.ts";
import { WORKING_WEEK } from "./fixtures.mjs";

/* Phase 13.10 — earning methods (`docs/02` §26.4) and the working-day calendar.
   B7 (closed 2026-10-20): discrete PV follows its earning points; only
   Percent Complete is linear over working days. */

const SUN_THU = new WorkingCalendar(WORKING_WEEK);
const day = (iso) => dayNumber(iso);

/* -------------------------------- Calendar -------------------------------- */

test("calendar: dates are calendar days, invalid dates are rejected rather than rolled over", () => {
  assert.equal(dayNumber("1970-01-01"), 0);
  assert.equal(dayNumber("2026-02-31"), null);
  assert.equal(dayNumber("31/10/2026"), null);
  assert.equal(dayNumber(null), null);
  assert.equal(calendarDaysBetween("2026-12-01", "2026-12-29"), 28);
});

test("calendar: working days are counted inclusively on the project's working week", () => {
  // Thu 8 Oct → Wed 4 Nov 2026 on Sun–Thu: 20 working days.
  assert.equal(SUN_THU.workingDaysInclusive(day("2026-10-08"), day("2026-11-04")), 20);
  // …16 of them on or before Sat 31 Oct.
  assert.equal(SUN_THU.workingDaysInclusive(day("2026-10-08"), day("2026-10-31")), 16);
  assert.equal(SUN_THU.workingDaysInclusive(day("2026-10-30"), day("2026-10-31")), 0, "Fri + Sat are rest days");
  assert.equal(SUN_THU.workingDaysInclusive(day("2026-11-04"), day("2026-10-08")), 0, "reversed range is empty");
});

test("calendar: the O(1) count matches a day-by-day count over a long range", () => {
  const monFri = new WorkingCalendar(["monday", "tuesday", "wednesday", "thursday", "friday"]);
  const from = day("2025-12-17");
  for (const to of [from, from + 1, from + 6, from + 13, from + 400]) {
    let slow = 0;
    for (let d = from; d <= to; d++) if (monFri.isWorkingDay(d)) slow++;
    assert.equal(monFri.workingDaysInclusive(from, to), slow);
  }
});

test("calendar: the stored Working Week labels parse, wrapping across the week end", () => {
  assert.deepEqual(parseWorkingWeek("Sun – Thu"), ["sunday", "monday", "tuesday", "wednesday", "thursday"]);
  assert.deepEqual(parseWorkingWeek("Mon – Fri"), ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  assert.deepEqual(parseWorkingWeek("Sat – Wed"), ["saturday", "sunday", "monday", "tuesday", "wednesday"]);
  assert.deepEqual(parseWorkingWeek("Sat – Thu").length, 6);
  assert.equal(parseWorkingWeek("Weekdays"), null, "never guesses a working week");
  assert.equal(parseWorkingWeek(undefined), null);
});

test("calendar: the weekly grid follows the reporting day and reaches completion", () => {
  const grid = weeklyGrid("2026-10-01", "2026-10-20", "thursday");
  assert.deepEqual(grid, ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
  assert.deepEqual(weeklyGrid("2026-10-20", "2026-10-01", "thursday"), []);
});

/* ------------------------------ PV by method ----------------------------- */

const window = { start: "2026-10-08", finish: "2026-11-04" };

test("PV Percent Complete: linear over working days — 16 of 20 is 80", () => {
  assert.equal(plannedPercentAt("percent_complete", window, day("2026-10-31"), SUN_THU), 80);
  assert.equal(plannedPercentAt("percent_complete", window, day("2026-10-07"), SUN_THU), 0);
  assert.equal(plannedPercentAt("percent_complete", window, day("2026-11-04"), SUN_THU), 100);
  assert.equal(plannedPercentAt("percent_complete", window, day("2026-10-08"), SUN_THU), 5, "1 of 20 on the start day");
});

test("PV Percent Complete: a window with no working day steps to 100 at its finish", () => {
  const weekend = { start: "2026-10-30", finish: "2026-10-31" };
  assert.equal(plannedPercentAt("percent_complete", weekend, day("2026-10-30"), SUN_THU), 0);
  assert.equal(plannedPercentAt("percent_complete", weekend, day("2026-10-31"), SUN_THU), 100);
});

test("PV 0/100 (B7): 0 until BLn finish, then 100 — never linear", () => {
  assert.equal(plannedPercentAt("zero_hundred", window, day("2026-10-31"), SUN_THU), 0);
  assert.equal(plannedPercentAt("zero_hundred", window, day("2026-11-04"), SUN_THU), 100);
});

test("PV 50/50 (B7): 50 at BLn start, 100 at BLn finish", () => {
  assert.equal(plannedPercentAt("fifty_fifty", window, day("2026-10-07"), SUN_THU), 0);
  assert.equal(plannedPercentAt("fifty_fifty", window, day("2026-10-08"), SUN_THU), 50);
  assert.equal(plannedPercentAt("fifty_fifty", window, day("2026-10-31"), SUN_THU), 50);
  assert.equal(plannedPercentAt("fifty_fifty", window, day("2026-11-04"), SUN_THU), 100);
});

test("PV Milestone (B7): 0 until the BLn date, then 100", () => {
  const milestone = { finish: "2026-12-15" };
  assert.equal(plannedPercentAt("milestone", milestone, day("2026-12-14"), SUN_THU), 0);
  assert.equal(plannedPercentAt("milestone", milestone, day("2026-12-15"), SUN_THU), 100);
  assert.equal(plannedPercentAt("milestone", { start: "2026-12-15" }, day("2026-12-15"), SUN_THU), 100);
});

test("PV: an unreadable window is null, never a fabricated 0", () => {
  assert.equal(plannedPercentAt("percent_complete", { start: "2026-10-08" }, day("2026-10-31"), SUN_THU), null);
  assert.equal(plannedPercentAt("zero_hundred", { start: "2026-11-04", finish: "2026-10-08" }, day("2026-10-31"), SUN_THU), null);
  assert.equal(plannedPercentAt("milestone", {}, day("2026-10-31"), SUN_THU), null);
});

test("B7: a 0/100 and a 50/50 activity progressing exactly on plan show no variance", () => {
  const at = day("2026-10-31");
  const zeroHundred = { kind: "activity", earningMethod: "zero_hundred", actual: { start: "2026-10-08" } };
  assert.equal(earnedPercentAt(zeroHundred, at) - plannedPercentAt("zero_hundred", window, at, SUN_THU), 0);
  const fiftyFifty = { kind: "activity", earningMethod: "fifty_fifty", actual: { start: "2026-10-08" } };
  assert.equal(earnedPercentAt(fiftyFifty, at) - plannedPercentAt("fifty_fifty", window, at, SUN_THU), 0);
});

/* ------------------------------ EV by method ----------------------------- */

const at = day("2026-10-31");

test("EV C1: not started earns 0 under every method — a fact, not missing data", () => {
  for (const earningMethod of ["percent_complete", "zero_hundred", "fifty_fifty", "milestone"]) {
    assert.equal(earnedPercentAt({ earningMethod, actual: null, percentComplete: null }, at), 0, earningMethod);
  }
});

test("EV Percent Complete: the confirmed physical %; started without one is null (C2), never 0", () => {
  assert.equal(earnedPercentAt({ earningMethod: "percent_complete", actual: { start: "2026-10-08" }, percentComplete: 60 }, at), 60);
  assert.equal(earnedPercentAt({ earningMethod: "percent_complete", actual: { start: "2026-10-08" } }, at), null);
});

test("EV 0/100: 0 until actual finish, then 100", () => {
  assert.equal(earnedPercentAt({ earningMethod: "zero_hundred", actual: { start: "2026-10-08" } }, at), 0);
  assert.equal(earnedPercentAt({ earningMethod: "zero_hundred", actual: { start: "2026-10-08", finish: "2026-10-29" } }, at), 100);
});

test("EV 50/50: 50 at actual start, 100 at actual finish", () => {
  assert.equal(earnedPercentAt({ earningMethod: "fifty_fifty", actual: { start: "2026-10-08" } }, at), 50);
  assert.equal(earnedPercentAt({ earningMethod: "fifty_fifty", actual: { start: "2026-10-08", finish: "2026-10-29" } }, at), 100);
});

test("EV Milestone: 0 until the actual date, then 100", () => {
  assert.equal(earnedPercentAt({ earningMethod: "milestone", actual: null }, at), 0);
  assert.equal(earnedPercentAt({ earningMethod: "milestone", actual: { finish: "2026-10-30" } }, at), 100);
});

test("EV: an actual date after the Data Date has not happened yet at the Data Date", () => {
  assert.equal(earnedPercentAt({ earningMethod: "zero_hundred", actual: { finish: "2026-11-02" } }, at), 0);
});
