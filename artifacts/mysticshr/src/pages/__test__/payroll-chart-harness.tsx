import { useEffect, useState } from "react";
import type { GetPayrollAnalytics200, PayrollRun } from "@workspace/api-client-react";
import { PayrollAnalyticsSection } from "../payroll";

declare global {
  interface Window {
    __navigateLog?: string[];
    __harnessReady?: boolean;
  }
}

const FIXTURE_ANALYTICS: GetPayrollAnalytics200 = {
  windowFrom: "2025-04",
  windowTo: "2026-03",
  financialYear: "2025-26",
  latestPeriodLabel: "March 2026",
  latestRunId: 1001,
  monthlyTrend: [
    { label: "Apr 2025", year: 2025, month: 4, totalGross: 1200000, totalNet: 950000, totalDeductions: 250000, employees: 18 },
    { label: "May 2025", year: 2025, month: 5, totalGross: 1230000, totalNet: 970000, totalDeductions: 260000, employees: 18 },
    { label: "Jun 2025", year: 2025, month: 6, totalGross: 1240000, totalNet: 975000, totalDeductions: 265000, employees: 19 },
    { label: "Jul 2025", year: 2025, month: 7, totalGross: 1260000, totalNet: 985000, totalDeductions: 275000, employees: 19 },
    { label: "Aug 2025", year: 2025, month: 8, totalGross: 1270000, totalNet: 990000, totalDeductions: 280000, employees: 19 },
    { label: "Sep 2025", year: 2025, month: 9, totalGross: 1280000, totalNet: 995000, totalDeductions: 285000, employees: 20 },
    { label: "Oct 2025", year: 2025, month: 10, totalGross: 1290000, totalNet: 1000000, totalDeductions: 290000, employees: 20 },
    { label: "Nov 2025", year: 2025, month: 11, totalGross: 1300000, totalNet: 1010000, totalDeductions: 290000, employees: 20 },
    { label: "Dec 2025", year: 2025, month: 12, totalGross: 1310000, totalNet: 1015000, totalDeductions: 295000, employees: 20 },
    { label: "Jan 2026", year: 2026, month: 1, totalGross: 1320000, totalNet: 1020000, totalDeductions: 300000, employees: 21 },
    { label: "Feb 2026", year: 2026, month: 2, totalGross: 1330000, totalNet: 1025000, totalDeductions: 305000, employees: 21 },
    { label: "Mar 2026", year: 2026, month: 3, totalGross: 1340000, totalNet: 1030000, totalDeductions: 310000, employees: 21 },
  ],
  departmentBreakdown: [
    { departmentId: 1, departmentName: "Engineering", totalGross: 800000, totalNet: 620000, totalDeductions: 180000, employees: 12 },
    { departmentId: 2, departmentName: "Human Resources", totalGross: 320000, totalNet: 250000, totalDeductions: 70000, employees: 5 },
    { departmentId: 3, departmentName: "Finance", totalGross: 220000, totalNet: 160000, totalDeductions: 60000, employees: 4 },
  ],
  statutoryDeductions: {
    pfEmployee: 144000,
    pfEmployer: 144000,
    esiEmployee: 24000,
    esiEmployer: 78000,
    professionalTax: 9600,
    tds: 360000,
  },
} as unknown as GetPayrollAnalytics200;

// Mix of statuses to verify Draft/Computed are skipped and Locked is preferred over Approved.
const FIXTURE_RUNS: PayrollRun[] = [
  { id: 1001, periodMonth: 3, periodYear: 2026, status: "Locked",   notes: "harness" },
  { id: 1002, periodMonth: 3, periodYear: 2026, status: "Approved", notes: "harness" },
  { id: 1003, periodMonth: 2, periodYear: 2026, status: "Approved", notes: "harness" },
  { id: 1004, periodMonth: 1, periodYear: 2026, status: "Computed", notes: "harness" }, // skipped
  { id: 1005, periodMonth: 1, periodYear: 2026, status: "Locked",   notes: "harness" }, // resolves Jan
  { id: 1006, periodMonth: 12, periodYear: 2025, status: "Draft",   notes: "harness" }, // skipped, no fallback
] as unknown as PayrollRun[];

export default function PayrollChartHarness() {
  const [deptPeriod, setDeptPeriod] = useState<{ year: number; month: number } | null>(null);
  useEffect(() => {
    window.__navigateLog = [];
    // Recharts default animation duration is 1500ms. Wait until the SVG paths
    // settle so Playwright clicks don't race with re-renders that detach nodes.
    const t = setTimeout(() => { window.__harnessReady = true; }, 1700);
    return () => {
      clearTimeout(t);
      window.__harnessReady = false;
    };
  }, []);

  const navigate = (path: string) => {
    (window.__navigateLog ??= []).push(path);
  };

  return (
    <div data-testid="payroll-chart-harness" style={{ padding: 16, width: 1200 }}>
      <PayrollAnalyticsSection
        analytics={FIXTURE_ANALYTICS}
        runs={FIXTURE_RUNS}
        deptPeriod={deptPeriod}
        setDeptPeriod={setDeptPeriod}
        navigateOverride={navigate}
      />
    </div>
  );
}
