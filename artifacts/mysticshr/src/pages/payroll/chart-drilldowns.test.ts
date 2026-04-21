// Unit tests for the payroll cost chart drill-down helpers (task #91).
//
// Recharts click payloads are notoriously brittle (raw datum vs
// `{payload: datum}` wrappers), and a future Recharts upgrade or chart-type
// swap could silently break click-through behavior. These tests pin down the
// pure logic — payload normalization, status-aware run resolution, and the
// statutory report URL — so a regression fails CI loudly instead of HR
// noticing weeks later when investigations stop working.
//
// Run with:  node --import tsx --test artifacts/mysticshr/src/pages/payroll/chart-drilldowns.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STATUTORY_TO_REPORT,
  buildStatutoryReportQuery,
  extractDatum,
  findRunIdForMonth,
  type RunLite,
} from "./chart-drilldowns";

describe("extractDatum", () => {
  it("returns undefined for nullish/non-object args", () => {
    assert.equal(extractDatum(undefined), undefined);
    assert.equal(extractDatum(null), undefined);
    assert.equal(extractDatum("foo"), undefined);
    assert.equal(extractDatum(42), undefined);
  });

  it("unwraps the Recharts Bar payload shape ({payload: datum})", () => {
    const datum = { year: 2026, month: 3, totalNet: 171600 };
    const wrapped = { payload: datum, value: 171600, fill: "#6366f1" };
    assert.deepEqual(extractDatum<typeof datum>(wrapped), datum);
  });

  it("returns the raw datum for the Recharts Pie shape (no payload key)", () => {
    const datum = { departmentId: 1, departmentName: "Engineering", totalNet: 85800 };
    assert.deepEqual(extractDatum<typeof datum>(datum), datum);
  });

  it("prefers payload over the surrounding wrapper when both are present", () => {
    // Bar callbacks pass an object whose top-level keys (value, fill, dataKey)
    // would shadow the datum's keys. We must always return the inner payload.
    const datum = { year: 2026, month: 3 };
    const wrapped = { payload: datum, year: 9999, month: 99, value: 1 };
    assert.deepEqual(extractDatum<{ year: number; month: number }>(wrapped), datum);
  });
});

describe("findRunIdForMonth — month-to-run resolver", () => {
  const baseRuns: RunLite[] = [
    { id: 1, periodYear: 2026, periodMonth: 3, status: "Draft" },
    { id: 2, periodYear: 2026, periodMonth: 3, status: "Computed" },
    { id: 3, periodYear: 2026, periodMonth: 3, status: "Approved" },
    { id: 4, periodYear: 2026, periodMonth: 2, status: "Locked" },
  ];

  it("returns null when runs is undefined", () => {
    assert.equal(findRunIdForMonth(undefined, 2026, 3), null);
  });

  it("returns null when no run matches the period", () => {
    assert.equal(findRunIdForMonth(baseRuns, 2025, 12), null);
  });

  it("returns null when only Draft/Computed runs exist for the period (skips them)", () => {
    const onlyUncommitted: RunLite[] = [
      { id: 10, periodYear: 2026, periodMonth: 4, status: "Draft" },
      { id: 11, periodYear: 2026, periodMonth: 4, status: "Computed" },
      { id: 12, periodYear: 2026, periodMonth: 4, status: "Processing" },
    ];
    assert.equal(findRunIdForMonth(onlyUncommitted, 2026, 4), null);
  });

  it("returns the Approved run when Draft/Computed coexist for the same period", () => {
    // The chart shows finalized figures, so click-through must never land on
    // a Draft/Computed run even when one exists for that month.
    assert.equal(findRunIdForMonth(baseRuns, 2026, 3), 3);
  });

  it("prefers Locked over Approved when both exist for the same period", () => {
    const both: RunLite[] = [
      { id: 20, periodYear: 2026, periodMonth: 5, status: "Approved" },
      { id: 21, periodYear: 2026, periodMonth: 5, status: "Locked" },
    ];
    assert.equal(findRunIdForMonth(both, 2026, 5), 21);
  });

  it("returns the lone Locked run", () => {
    assert.equal(findRunIdForMonth(baseRuns, 2026, 2), 4);
  });
});

describe("STATUTORY_TO_REPORT mapping", () => {
  it("covers every statutory bar label rendered by the dashboard", () => {
    // The PayrollAnalyticsSection renders exactly these six bars; if a new bar
    // is added without updating the map, its click would silently no-op.
    const renderedBars = [
      "PF (Employee)", "PF (Employer)",
      "ESI (Employee)", "ESI (Employer)",
      "Professional Tax", "TDS",
    ];
    for (const bar of renderedBars) {
      assert.ok(STATUTORY_TO_REPORT[bar], `Missing report mapping for "${bar}"`);
    }
  });

  it("groups PF (employee + employer) under pf-ecr and ESI under esi", () => {
    assert.equal(STATUTORY_TO_REPORT["PF (Employee)"], "pf-ecr");
    assert.equal(STATUTORY_TO_REPORT["PF (Employer)"], "pf-ecr");
    assert.equal(STATUTORY_TO_REPORT["ESI (Employee)"], "esi");
    assert.equal(STATUTORY_TO_REPORT["ESI (Employer)"], "esi");
  });
});

describe("buildStatutoryReportQuery", () => {
  it("returns null for unknown bar names (silently ignores stray clicks)", () => {
    assert.equal(buildStatutoryReportQuery("Mystery Tax", { year: 2026, month: 3 }), null);
  });

  it("returns just the type when there's no finalized month yet", () => {
    assert.equal(
      buildStatutoryReportQuery("PF (Employee)", undefined),
      "type=pf-ecr",
    );
  });

  it("anchors the FY window to April of the prior calendar year when latest month < April (Indian FY)", () => {
    // Latest = March 2026 → FY 2025-26 → fromYear=2025, fromMonth=4, toYear=2026, toMonth=3.
    const qs = buildStatutoryReportQuery("PF (Employee)", { year: 2026, month: 3 });
    const params = new URLSearchParams(qs ?? "");
    assert.equal(params.get("type"), "pf-ecr");
    assert.equal(params.get("filterMode"), "range");
    assert.equal(params.get("fromYear"), "2025");
    assert.equal(params.get("fromMonth"), "4");
    assert.equal(params.get("toYear"), "2026");
    assert.equal(params.get("toMonth"), "3");
  });

  it("anchors the FY window to April of the same calendar year when latest month >= April", () => {
    // Latest = July 2026 → FY 2026-27 → fromYear=2026, fromMonth=4, toYear=2026, toMonth=7.
    const qs = buildStatutoryReportQuery("ESI (Employer)", { year: 2026, month: 7 });
    const params = new URLSearchParams(qs ?? "");
    assert.equal(params.get("type"), "esi");
    assert.equal(params.get("fromYear"), "2026");
    assert.equal(params.get("fromMonth"), "4");
    assert.equal(params.get("toYear"), "2026");
    assert.equal(params.get("toMonth"), "7");
  });

  it("handles the FY-boundary month correctly (April = month 4 anchors to same year)", () => {
    const qs = buildStatutoryReportQuery("TDS", { year: 2026, month: 4 });
    const params = new URLSearchParams(qs ?? "");
    assert.equal(params.get("fromYear"), "2026");
    assert.equal(params.get("toYear"), "2026");
  });
});
