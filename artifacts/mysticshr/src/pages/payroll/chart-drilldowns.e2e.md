# E2E test plan — Payroll cost chart drill-downs (task #91)

This is the canonical end-to-end test plan for the three click-through
behaviors on the payroll dashboard cost charts (added in task #48). The
unit tests in `chart-drilldowns.test.ts` pin down the pure logic; this
plan exercises real Recharts SVG clicks in a real browser to catch
regressions that only surface when the chart actually renders.

## How to run

Execute via the testing skill (`runTest`) with `testClerkAuth: true`.
The plan seeds and tears down its own data via `[DB]` steps, so it can
be re-run safely against the development database.

## What it asserts

1. **Department pie slice → drill-down dialog** opens with the correct
   department in the title, the right number of records, and only the
   employees that actually belong to that department.
2. **Monthly Net Cost bar → `/payroll/runs/<approvedRunId>`**, _skipping_
   any Draft/Computed run for the same period. The setup deliberately
   creates both an Approved and a Draft run for `2026-03` and asserts
   the click resolves to the Approved run id, not the Draft id.
3. **Statutory bar → pre-filtered, auto-fetched report.** Clicking the
   "PF (Employee)" bar navigates to
   `/payroll/reports?type=pf-ecr&filterMode=range&fromYear=2025&fromMonth=4&toYear=2026&toMonth=3`
   (the Indian FY window anchored on the latest finalized month) and the
   reports page renders the report card immediately, _without_ the
   "Select period and click Generate Report" placeholder.

## Test plan

> NOTE: Use a fixed lowercase email (no nanoid). Clerk normalizes emails
> to lowercase, so a mixed-case email won't match the DB seed during
> `/api/auth/provision`. Replace the timestamp suffix per run.

```text
GOAL: Verify the three click-through behaviors on the payroll dashboard cost charts.

TEST_EMAIL = "autotest_drilldown_<timestamp>@example.com"   (all lowercase)

SETUP

1. [New Context] Create a new browser context (1400x900).

2. [DB] Seed the test super_admin row that Clerk provisioning will link to:
   INSERT INTO hrms_users (clerk_user_id, email, name, role, is_active, created_at, updated_at)
   VALUES ('pending_autotest_drilldown_1', '<TEST_EMAIL>', 'AutoTest DrillDown', 'super_admin', true, now(), now());

3. [DB] Insert an Approved payroll run for 2026-03; capture id as ${approvedRunId}:
   INSERT INTO payroll_runs (period_year, period_month, status, total_employees,
     total_gross, total_deductions, total_net, notes, created_at, updated_at,
     run_at, approved_at, initiated_by_id, approved_by_id)
   VALUES (2026, 3, 'Approved', 2, 200000, 28400, 171600, 'AUTOTEST_DRILLDOWN_APPROVED',
     now(), now(), now(), now(), 1, 1)
   RETURNING id;

4. [DB] Insert a Draft run for the SAME period; capture id as ${draftRunId}.
   The chart click MUST resolve to ${approvedRunId}, not this:
   INSERT INTO payroll_runs (period_year, period_month, status, total_employees,
     total_gross, total_deductions, total_net, notes, created_at, updated_at)
   VALUES (2026, 3, 'Draft', 0, 0, 0, 0, 'AUTOTEST_DRILLDOWN_DRAFT', now(), now())
   RETURNING id;

5. [DB] Two payroll records on the Approved run, one per department
   (employee 1 = Arjun in Engineering; employee 2 = Priya in Human Resources):
   INSERT INTO payroll_records (payroll_run_id, employee_id, working_days, present_days,
     leave_days, lop_days, overtime_hours, basic, hra, special_allowance, travel_allowance,
     medical_allowance, performance_bonus, shift_allowance, night_differential, other_earnings,
     gross_earnings, pf_employee, pf_employer, esi_employee, esi_employer, professional_tax,
     tds, lop_deduction, loan_deduction, other_deductions, total_deductions, net_pay,
     status, created_at, updated_at)
   VALUES
     (${approvedRunId}, 1, 30, 30, 0, 0, 0, 50000, 20000, 30000, 0, 0, 0, 0, 0, 0,
       100000, 6000, 6000, 0, 0, 200, 8000, 0, 0, 0, 14200, 85800, 'Computed', now(), now()),
     (${approvedRunId}, 2, 30, 30, 0, 0, 0, 50000, 20000, 30000, 0, 0, 0, 0, 0, 0,
       100000, 6000, 6000, 0, 0, 200, 8000, 0, 0, 0, 14200, 85800, 'Computed', now(), now());

AUTH

6. [Clerk Auth] Sign in as { firstName: "AutoTest", lastName: "DrillDown", email: <TEST_EMAIL> }.
7. [Browser] Navigate to /payroll.
8. [Verify] Heading "Payroll Management" is visible, a row for "March 2026" / Approved
   appears in the Payroll Run History, and all three chart cards render.

(a) DEPARTMENT PIE → DRILL-DOWN

9.  [Browser] Inside "Department-wise Cost", click the pie label or slice for "Engineering".
10. [Verify] A modal dialog opens whose title contains both "Engineering" and "March 2026".
11. [Verify] The dialog shows "1 employee", a row for "Arjun Sharma" (or AMT-2024-001),
    and NO row for "Priya Venkataraman".
12. [Browser] Close the dialog.

(b) MONTHLY NET COST BAR → APPROVED RUN, NOT DRAFT

13. [Browser] Inside "Headcount vs Cost", click the Net Cost bar for March 2026.
14. [Verify] Pathname is exactly /payroll/runs/${approvedRunId} — NOT /payroll/runs/${draftRunId}.
15. [Browser] Navigate back to /payroll.

(c) STATUTORY BAR → PRE-FILTERED, AUTO-FETCHED REPORT

16. [Browser] Inside "Statutory Contributions", click the "PF (Employee)" bar.
17. [Verify] URL is /payroll/reports?type=pf-ecr&filterMode=range&fromYear=2025&fromMonth=4&toYear=2026&toMonth=3.
18. [Verify] "PF ECR File" tile is selected; a Card titled "PF ECR File — March 2025 to March 2026"
    is rendered (NOT the "Select period and click Generate Report" placeholder).

CLEANUP

19. [DB]
    DELETE FROM payroll_records WHERE payroll_run_id IN
      (SELECT id FROM payroll_runs WHERE notes LIKE 'AUTOTEST_DRILLDOWN%');
    DELETE FROM payroll_runs WHERE notes LIKE 'AUTOTEST_DRILLDOWN%';
    DELETE FROM hrms_users WHERE email = '<TEST_EMAIL>';
```

## Last-known result

This plan was executed with `runTest({ testClerkAuth: true })` on
2026-04-21 and returned **status: success**, with all three drill-down
behaviors verified end-to-end.
