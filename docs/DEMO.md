# MysticsHR — Demo Documentation

**Version:** 1.0  
**Build date:** April 22, 2026  
**Audience:** HR leadership, IT champions, demo presenters

This guide walks through every module in MysticsHR, the integrated HRMS for Automystics Technologies. It includes screenshots of every important screen, the role required to reach it, and the demo path to follow during a live walk-through.

---

## 1. Demo accounts

All accounts use the password **`DemoTest123!@#`**.

| Role | Sign-in email | What they see |
|---|---|---|
| Super Admin | `arjun.sharma@automystics.com` | Everything across every module |
| HR Manager | `priya.v@automystics.com` | Full HR + Onboarding + Leave + Performance + Documents |
| Payroll Admin | `ravi.kumar@automystics.com` | Payroll runs, payslips, salary structures, tax declarations |
| HR Executive | `meena.r@automystics.com` | Employees (read), Onboarding, Helpdesk, Documents |
| HOD | `suresh.b@automystics.com` | Team members, leave approvals, performance reviews |
| Employee (ESS) | `kavitha.n@automystics.com` | Self-service: attendance, leave, payslips, helpdesk |

> Sign in at **`/sign-in`**. The first sign-in links the Clerk identity to the seeded HRMS user.

---

## 2. Module overview

The system is organised into nine functional modules:

1. **Employees & Org Structure** — directory, departments, designations, org chart  
2. **Onboarding & Recruitment** — pre-onboarding, requisitions, candidates, joining checklist  
3. **Attendance & Shifts** — clock in/out, regularization, shift calendar  
4. **Leave Management** — apply, approve, calendar, policies, leave types  
5. **Payroll** — runs, payslips, salary structures, tax declarations, reports  
6. **Performance Management** — cycles, goals, appraisals, calibration  
7. **Helpdesk** — tickets with full SLA tracking  
8. **Documents** — templates, issued letters  
9. **Communications, Reporting & System Config** — notifications, analytics, audit, role configuration

---

## Module 1 — Employees & Org Structure

**Demo as:** HR Manager (`priya.v@automystics.com`)

### Dashboard

The first thing every authenticated user sees. Shows headcount KPIs, status breakdown, and a recent-activity feed.

![Dashboard](demo-screenshots/01-dashboard.png)

### Employee directory

`/employees` — searchable, filterable list of every employee with department, designation, and status.

![Employee directory](demo-screenshots/02-employees-list.png)

### Add a new employee

`/employees/new` — three-section form (Identity, Position, Employment). Department→Designation cascades; manager picker pulls from active employees. Submitting auto-creates the onboarding checklist for the new hire.

![New employee form](demo-screenshots/03-employees-new.png)

**Demo flow:**
1. Open `/employees/new`
2. Fill Identity (name, employee ID, email, phone)
3. Pick Department → watch Designation list filter
4. Set Employment Type and CTC, then **Create Employee**
5. Land on the employee detail page; check `/onboarding` to see the auto-generated checklist for the new hire

### Departments and designations

![Departments](demo-screenshots/04-departments.png)

![Designations](demo-screenshots/05-designations.png)

### Org chart

`/org-chart` — visualises reporting lines.

![Org chart](demo-screenshots/06-org-chart.png)

---

## Module 2 — Onboarding & Recruitment

**Demo as:** HR Executive (`meena.r@automystics.com`)

### Onboarding pipeline

`/onboarding` — every new hire's status with completion percentage. Lakshmi Iyer (latest joiner) has an active checklist seeded with 7 mixed-status tasks.

![Onboarding pipeline](demo-screenshots/07-onboarding-list.png)

### Pre-onboarding

`/pre-onboarding` — for offers issued but joining still pending.

![Pre-onboarding](demo-screenshots/08-pre-onboarding.png)

### Recruitment

`/recruitment` — requisitions and candidate pipeline.

![Recruitment](demo-screenshots/09-recruitment.png)

**Demo flow:**
1. Open `/onboarding`, click Lakshmi's record
2. Walk through the 7 tasks (documentation, ID card, equipment, etc.)
3. Mark a pending task complete → progress percentage updates live

---

## Module 3 — Attendance & Shifts

**Demo as:** Employee (`kavitha.n@automystics.com`) for ESS, HR Manager for admin views

### My Attendance (ESS)

`/my-attendance` — clock in/out widget, today's status, last 30 days history. Every seeded employee has 30 days of attendance.

![My Attendance](demo-screenshots/10-my-attendance.png)

### Attendance summary (HR view)

`/attendance/summary` — aggregate present/absent/half-day across the org.

![Attendance summary](demo-screenshots/11-attendance-summary.png)

### Regularization

`/attendance/regularization` — employees flag missed punches; HR approves/rejects.

![Regularization](demo-screenshots/12-attendance-regularization.png)

### Shifts & calendar

`/shifts` lists templates (Morning, General, Night, Flexible). `/shifts/calendar` shows the rotation.

![Shifts](demo-screenshots/13-shifts.png)

![Shift calendar](demo-screenshots/14-shifts-calendar.png)

**Demo flow:**
1. Sign in as Kavitha → `/my-attendance` → click Clock-In
2. Switch to Priya → `/attendance/regularization` → approve the seeded request
3. Show `/attendance/summary` for org-wide view

---

## Module 4 — Leave Management

**Demo as:** Employee for application, HR Manager for approval

### Employee leave home

`/leave` — balance per leave type, recent applications, apply form.

![Leave (employee)](demo-screenshots/15-leave-employee.png)

### Approval queue

`/leave/approvals` — pending applications routed to the right approver. 5 mixed-status applications are seeded.

![Leave approvals](demo-screenshots/16-leave-approvals.png)

### Leave calendar

`/leave/calendar` — see who is out at a glance.

![Leave calendar](demo-screenshots/17-leave-calendar.png)

### Configuration

`/leave/types` (6 seeded leave types) and `/leave/policies` (1:1 policies per type with carry-forward rules).

![Leave types](demo-screenshots/18-leave-types.png)

![Leave policies](demo-screenshots/19-leave-policies.png)

**Demo flow:**
1. Sign in as Kavitha → `/leave` → apply for 2 days of Casual Leave
2. Sign in as Priya → `/leave/approvals` → approve
3. Back on Kavitha's `/leave` → balance reduces, calendar updates

---

## Module 5 — Payroll

**Demo as:** Payroll Admin (`ravi.kumar@automystics.com`)

### Payroll runs

`/payroll` — 2 finalised runs (Locked) plus 1 draft for the current month, all with payslip generation.

![Payroll runs](demo-screenshots/20-payroll-runs.png)

### Salary structures

`/payroll/salary-structures` — 7 components per employee (Basic, HRA, Special Allowance, PF, ESI, Professional Tax, TDS).

![Salary structures](demo-screenshots/21-payroll-salary-structures.png)

### Payslips

`/payroll/payslips` — every issued payslip, downloadable.

![Payslips](demo-screenshots/22-payroll-payslips.png)

### Reports

`/payroll/reports` — register, Form 16, statutory summaries.

![Payroll reports](demo-screenshots/23-payroll-reports.png)

### Tax declarations

`/payroll/tax-declaration` — employees submit 80C / HRA / interest declarations.

![Tax declaration](demo-screenshots/24-payroll-tax-declaration.png)

**Demo flow:**
1. `/payroll` → open the draft run for the current month
2. Click **Calculate** → review preview, then **Lock**
3. Open the latest locked run → drill into a payslip → download PDF

---

## Module 6 — Performance Management

**Demo as:** HR Manager (or HOD for evaluator view)

### Active cycle

`/performance` — the seeded annual cycle is in **Mid Review** stage with self-appraisals and manager evaluations underway.

![Performance overview](demo-screenshots/25-performance.png)

### Goals

`/performance/goals` — 3 goals per employee with progress percentages.

![Goals](demo-screenshots/26-performance-goals.png)

### Appraisals

`/performance/appraisals` — track self-appraisal and manager-evaluation status across the org.

![Appraisals](demo-screenshots/27-performance-appraisals.png)

### Calibration

`/performance/calibration` — bell-curve / rating distribution before final lock.

![Calibration](demo-screenshots/28-performance-calibration.png)

**Demo flow:**
1. `/performance` → open the active cycle
2. Walk into a goal → update progress
3. Switch to HOD (Suresh) → `/performance/evaluations` → submit a manager rating

---

## Module 7 — Helpdesk

**Demo as:** Employee (raise) → HR Executive (resolve)

### Ticket list

`/helpdesk` — 5 seeded tickets across **Open / In Progress / Resolved / Closed**.

![Helpdesk tickets](demo-screenshots/29-helpdesk-list.png)

### SLA report

`/helpdesk/sla-report` — within-SLA vs. breached over the trailing period.

![SLA report](demo-screenshots/30-helpdesk-sla.png)

**Demo flow:**
1. Sign in as Kavitha → `/helpdesk` → **Raise Ticket** (e.g., "Need updated payslip for March")
2. Sign in as Meena → `/helpdesk` → open the ticket → comment & change status to **In Progress**
3. Resolve → ticket count moves on the SLA report

---

## Module 8 — Documents

**Demo as:** HR Manager

`/documents` lists templates (Offer, Experience, Appointment) and every issued document.

![Documents](demo-screenshots/31-documents.png)

**Demo flow:**
1. From an employee detail page, click **Issue Document** → pick "Experience Letter"
2. Preview merged content (employee fields auto-populated)
3. Generate → appears in `/documents` with a download link

---

## Module 9 — Communications, Reporting & System Config

**Demo as:** Super Admin (`arjun.sharma@automystics.com`)

### Communications

`/communications` — bulk announcement composer, in-app notifications, email logs.

![Communications](demo-screenshots/32-communications.png)

### Analytics

`/analytics` — headcount trends, attrition, leave utilisation.

![Analytics](demo-screenshots/33-analytics.png)

### Reports library

`/reports` — exportable reports across modules.

![Reports](demo-screenshots/34-reports.png)

### Audit log

`/audit-logs` — every privileged change with actor, timestamp, before/after.

![Audit log](demo-screenshots/35-audit-logs.png)

### Users & roles

`/users` — manage HRMS users; `/permissions` shows the role-permission matrix.

![Users](demo-screenshots/36-users.png)

![Permissions](demo-screenshots/37-permissions.png)

### Settings

`/settings` — organisation profile, work locations, fiscal year, integrations.

![Settings](demo-screenshots/38-settings.png)

---

## Bonus — Employee Self-Service hub

`/ess` is the consolidated landing page for employees: attendance, leave balance, payslips, tickets, profile.

![ESS](demo-screenshots/39-ess.png)

---

## Suggested 15-minute demo script

| Min | Action | Role |
|---|---|---|
| 0:00 | Sign in, tour Dashboard & Employee Directory | HR Manager |
| 2:00 | Create a new employee → land on detail → show auto-onboarding | HR Manager |
| 4:00 | Switch role → mark an onboarding task complete | HR Executive |
| 5:30 | ESS clock-in, apply for leave | Employee |
| 7:00 | Approve the leave, show calendar update | HR Manager |
| 8:30 | Open draft payroll run, lock it, drill into payslip | Payroll Admin |
| 11:00 | Walk through performance cycle → goal update → manager eval | HR Manager + HOD |
| 13:00 | Raise a helpdesk ticket → resolve → SLA report | Employee + HR |
| 14:30 | Audit log + user/role matrix | Super Admin |

---

## Resetting the demo data

If demo data drifts (deleted records, partially completed flows), reseed with:

```bash
# Repopulate every operational table
node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs artifacts/api-server/src/seed.ts

# Re-link Clerk users to HRMS roles (idempotent)
node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs artifacts/api-server/scripts/seed-clerk-users.ts

# Re-capture screenshots for the docs (after UI changes)
node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs artifacts/api-server/scripts/capture-demo-screenshots.ts
```
