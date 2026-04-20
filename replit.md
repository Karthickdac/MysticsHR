# MysticsHR Workspace

## Overview

MysticsHR — a comprehensive Human Resource Management System (HRMS) built for Automystics Technologies Private Limited. It manages the complete employee lifecycle with role-based access control for 6 roles.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Wouter
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Clerk (via @clerk/express and @clerk/react)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle)

## Architecture

```
/
├── lib/
│   ├── api-spec/         # OpenAPI spec + Orval codegen config
│   ├── api-client-react/ # Generated React Query hooks
│   ├── api-zod/          # Generated Zod schemas
│   └── db/               # Drizzle ORM schema + migration config
├── artifacts/
│   ├── api-server/       # Express API server (port via $PORT)
│   └── mysticshr/        # React+Vite frontend (preview path: /)
```

## Roles

- **super_admin**: Full access to all modules
- **hr_manager**: Dashboard, Employees, Departments, Designations, Audit Logs, Settings
- **hr_executive**: Dashboard, Employees, Departments, Designations
- **hod**: Dashboard, Employees (own dept)
- **payroll_admin**: Dashboard, Employees (read-only)
- **employee**: Dashboard (limited)

## Database Schema (lib/db/src/schema/)

- `departments`: name, code, description, headId, isActive, soft-delete
- `designations`: title, code, departmentId, level, isActive, soft-delete
- `employees`: employeeId, names, email, phone, DOB, gender, dept, desig, employmentType, status, DOJ, CTC, managerId, location, soft-delete
- `hrms_users`: clerkUserId, employeeId, email, name, role, isActive
- `audit_logs`: userId, userEmail, action, module, recordId, fieldName, previousValue, newValue, ipAddress
- `employee_profiles`: pan, aadhaar, nationalId, maritalStatus, bloodGroup, bank info (accountNo, ifsc, bankName), probation dates, emergency contact, address fields
- `employee_education`: degree, institution, fieldOfStudy, startYear, endYear, grade, employeeId
- `employee_work_experience`: company, designation, location, startDate, endDate, responsibilities, employeeId
- `employee_documents`: docType, docNumber, issueDate, expiryDate, alertDays, fileUrl, status, employeeId
- `employee_history`: fieldName, oldValue, newValue, changedById, module (field-level audit trail)
- `onboarding_checklists`: employeeId, status, completionPct, idCardGeneratedAt
- `onboarding_tasks`: checklistId, title, category (HR/IT/Department/Employee), assigneeRole, dueDate, completedAt, completedById, notes
- `induction_sessions`: employeeId, sessionDate, trainerName, topics, notes, recordedById
- `shift_templates`: name, shiftType (Fixed/Flexible/Rotational/Night Shift), startTime, endTime, gracePeriodMinutes, breakDurationMinutes, minWorkingHoursMinutes, weeklyOff (array), departmentId, shiftRatePerHour, nightDifferentialRate, overtimeThresholdMinutes, isActive
- `shift_assignments`: employeeId, shiftTemplateId, effectiveFrom, effectiveTo, assignedById
- `shift_swaps`: requesterEmployeeId, swapWithEmployeeId, swapDate, reason, hodStatus, hodRemarks, hodActionedById, hrStatus, hrRemarks, hrActionedById
- `attendance_records`: employeeId, attendanceDate, signInTime, signOutTime, totalMinutesWorked, breakDurationMinutes, overtimeMinutes, status (Present/Absent/Half-Day/On Leave/On Permission/Holiday/Week Off/Regularization Pending), isHrOverride, overrideReason, overrideById
- `attendance_regularizations`: employeeId, attendanceDate, requestedSignIn, requestedSignOut, reason, status (Pending/Approved/Rejected), hodActionedById, hodRemarks, attendanceRecordId
- `overtime_records`: employeeId, attendanceDate, overtimeMinutes, ratePerHour, totalAmount, attendanceRecordId

## API Routes (all under /api)

- `GET /api/healthz` — health check (public)
- `GET /api/dashboard/kpis` — KPI metrics
- `GET /api/dashboard/recent-activity` — activity feed
- `GET /api/dashboard/headcount-by-department` — dept headcount
- `GET /api/dashboard/employee-status-breakdown` — status breakdown
- `GET|POST /api/departments` — list/create departments
- `GET|PUT|DELETE /api/departments/:id` — get/update/delete department
- `GET|POST /api/designations` — list/create designations
- `GET|PUT|DELETE /api/designations/:id` — get/update/delete designation
- `GET|POST /api/employees` — list/create employees
- `POST /api/employees/bulk-import` — CSV bulk import (rows array)
- `GET|PUT|DELETE /api/employees/:id` — get/update/delete employee
- `PATCH /api/employees/:id/status` — update employee status
- `GET|PUT /api/employees/:id/profile` — extended profile (PAN, Aadhaar, bank, address)
- `GET|POST /api/employees/:id/education` — list/add education records
- `PATCH|DELETE /api/employee-education/:id` — update/delete education record
- `GET|POST /api/employees/:id/work-experience` — list/add work experience
- `PATCH|DELETE /api/employee-work-experience/:id` — update/delete experience
- `GET|POST /api/employees/:id/documents` — list/add HR documents
- `PATCH|DELETE /api/employee-documents/:id` — update/delete document
- `GET /api/employees/:id/history` — field-level change history
- `GET /api/employees/:id/id-card` — download employee ID card PDF (requires 100% onboarding)
- `GET|POST /api/users` — list/create HRMS users
- `GET /api/users/me` — current user profile
- `GET|PUT /api/users/:id` — get/update user
- `GET /api/audit-logs` — list audit logs
- `GET /api/onboarding/checklists` — list all onboarding checklists
- `POST /api/employees/:id/onboarding/checklist` — create checklist (auto-seeds 10 default tasks)
- `GET /api/onboarding/checklists/:id` — checklist detail with tasks
- `POST /api/onboarding/tasks/:id/complete` — mark task complete
- `POST /api/onboarding/tasks/:id/uncomplete` — unmark task
- `GET|POST /api/employees/:id/induction-sessions` — list/add induction sessions
- `PUT|DELETE /api/induction-sessions/:id` — update/delete induction session
- `GET /api/shifts/templates` — list shift templates (HR Read roles)
- `POST /api/shifts/templates` — create shift template (HR roles)
- `GET|PATCH|DELETE /api/shifts/templates/:id` — get/update/delete shift template
- `GET|POST /api/employees/:id/shift-assignments` — list/assign shifts for employee
- `DELETE /api/shift-assignments/:id` — remove shift assignment
- `GET /api/shifts/calendar` — shift calendar for month (with dept/employee filter)
- `GET|POST /api/shift-swaps` — list/create shift swap requests
- `POST /api/shift-swaps/:id/hod-action` — HOD approve/reject swap
- `POST /api/shift-swaps/:id/hr-action` — HR approve/reject swap
- `GET|POST /api/attendance` — list/create attendance records
- `GET|PATCH /api/attendance/:id` — get record; PATCH = HR override with required overrideReason
- `GET /api/attendance/summary` — monthly summary (aggregated per employee)
- `GET|POST /api/attendance/regularizations` — list/submit regularization requests
- `POST /api/attendance/regularizations/:id/action` — HOD approve/reject regularization (applies times to attendance record on approval)
- `GET /api/employees/:id/attendance` — employee attendance records (self-service: employee can only view own)
- `GET /api/employees/:id/overtime` — employee overtime records

## Frontend Pages (artifacts/mysticshr/src/)

- `/` — Landing page (public, redirects to /dashboard if signed in)
- `/sign-in` — Clerk sign-in (custom branded)
- `/sign-up` — Clerk sign-up (custom branded)
- `/dashboard` — KPI tiles, charts, activity feed
- `/employees` — Employee directory with search/filter/pagination + CSV bulk import dialog
- `/employees/:id` — Employee detail with 9 tabs (Personal, Statutory & Bank, Address & Emergency, Employment, Education, Work History, Documents, History, Onboarding)
- `/employees/new` — New employee (placeholder)
- `/departments` — Dept management with create/edit/delete
- `/designations` — Designation management with create/edit/delete
- `/users` — User account management (Super Admin)
- `/audit-logs` — Audit log viewer with table + filter
- `/settings` — Settings placeholder
- `/recruitment` — Job requisitions list + Candidate pipeline (Kanban)
- `/recruitment/requisitions/:id` — Requisition detail + linked candidates
- `/recruitment/candidates/:id` — Candidate profile + interviews + offers
- `/pre-onboarding` — Pre-onboarding records list
- `/pre-onboarding/:id` — Document review (verify/reject) with auto completion %
- `/onboarding` — Onboarding dashboard (checklists with progress bars)
- `/onboarding/:id` — Onboarding detail (task completion per category, induction sessions, ID card download)
- `/shifts` — Shift Management: 3 tabs — Shift Templates (CRUD cards), Assign Shifts (employee picker + template picker + date range), Swap Requests (HOD/HR action buttons)
- `/shifts/calendar` — Monthly calendar grid showing each employee's shift + attendance status per day
- `/attendance` — Daily attendance list with date/status filters; HR Record Attendance dialog + HR Override dialog (requires overrideReason)
- `/attendance/regularization` — List regularization requests; employee submit dialog; HOD review dialog (Approve/Reject)
- `/attendance/summary` — Monthly aggregated summary table (Present/Absent/Half-Day/On Leave/Week Off/Holiday/OT/Total) with CSV export

## Recruitment & Pre-Onboarding (Task #2)

- 7 DB tables: `job_requisitions`, `candidates`, `interview_rounds`, `interview_feedback`, `offer_letters`, `pre_onboarding_records`, `pre_onboarding_documents`
- Backend routes: `routes/recruitment.ts` and `routes/pre-onboarding.ts`. RBAC via `requireRole(...)` on all writes; reads gated by `requireHrmsUser`
- Offer acceptance auto-creates a `pre_onboarding_record` and seeds 9 default documents (Aadhaar, PAN, Bank, Photo, Educational, Experience, Relieving, Salary Slip, Address Proof)
- Document verify/reject auto-recomputes `completion_percentage` based on required documents verified
- Candidate stage auto-syncs when interviews are scheduled/completed and when offers are issued/accepted
- Source-of-hire enum values: LinkedIn, Naukri, Indeed, Referral, Walk-In, Campus, Agency, Company Website, Other

## Employee Master & Onboarding (Task #3)

- 8 DB tables: `employee_profiles`, `employee_education`, `employee_work_experience`, `employee_documents`, `employee_history`, `onboarding_checklists`, `onboarding_tasks`, `induction_sessions`
- Backend routes: `routes/employees-extended.ts` (profile, edu, work-exp, docs, history, bulk-import) and `routes/onboarding.ts` (checklists, tasks, induction, ID card)
- Field-level history logging on all profile/statutory updates (stored in `employee_history`)
- ID card generated as PDF using `pdf-lib` (no native deps); requires onboarding at 100%
- QR code on ID card via `qrcode` package (encodes employee ID + name + department)
- Bulk CSV import: accepts `rows` array of key-value objects; skips duplicates by email; returns `{imported, skipped, errors[]}`
- Onboarding checklist auto-seeds 10 default tasks across 4 categories: HR (3), IT (3), Department (2), Employee (2)
- Completion % = (completed tasks / total tasks) × 100

## Leave & Permission Management (Task #5)

- 7 DB tables: `leave_types`, `leave_balances`, `leave_applications`, `leave_accrual_history`, `blackout_dates`, `permission_applications`, `permission_registers`
- Backend routes: `routes/leave.ts` (leave type CRUD, application workflow, balance tracking, calendar, blackout dates) and `routes/permissions.ts` (permission applications, monthly register, HR override)
- Leave types configurable: CL, SL, EL, Maternity/Paternity, Comp-Off, Bereavement, Marriage, and custom types with annual quota, carry-forward, encashment, advance notice, HOD/HR approval flags
- Multi-level approval: Employee → HOD → HR Manager (configurable per leave type via requiresHodApproval/requiresHrApproval flags)
- Policy validations: balance check (LOP warning flow), advance notice, blackout date overlap, duplicate application overlap
- Leave balances initialize via `POST /leave/balances/initialize`; available = allocated + carryForward - used - pending
- Permission monthly limit defaults to 240 minutes (4hrs); enforced on submission; HR can override per-employee per-month
- Permission approval auto-updates `permission_registers.usedMinutes`; cancellation restores balance
- All mutations wrapped in `db.transaction()` for atomicity; state-machine guards prevent re-processing
- HOD scope: HOD can only action requests from employees in their department (403 otherwise)
- Frontend pages: `/leave` (apply + balance summary + my applications), `/leave/types` (HR config), `/leave/calendar` (team calendar + blackout dates), `/leave/approvals` (HOD/HR queue + balance init), `/permissions` (apply + monthly register + HR override)

## Attendance & Shift Management (Task #4)

- 6 DB tables: `shift_templates`, `shift_assignments`, `shift_swaps`, `attendance_records`, `attendance_regularizations`, `overtime_records`
- Backend routes: `routes/shifts.ts` (templates, assignments, swaps) and `routes/attendance.ts` (daily records, override, regularization workflow, summary, overtime)
- Shift types: Fixed, Flexible, Rotational, Night Shift
- Attendance statuses: Present, Absent, Half-Day, On Leave, On Permission, Holiday, Week Off, Regularization Pending
- Overtime auto-calculated when totalMinutesWorked > minWorkingHoursMinutes + overtimeThreshold; overtime record created automatically
- Regularization workflow: Employee submits → HOD reviews (Approve/Reject) → on Approve, times applied to attendance_records
- Shift swap workflow: Employee requests → HOD approves/rejects → HR approves/rejects (both steps required)
- HR override: Any HR role can override sign-in/out/status on any attendance record; `overrideReason` is required; flagged with `isHrOverride=true`
- Employee self-service: `/api/employees/:id/attendance` enforces ownership check (employee can only view own records)
- Shift calendar endpoint generates per-day entries from active shift assignments, merged with attendance status for that day
- Monthly summary aggregates counts per status per employee; CSV export on frontend

## Performance Management & ESS Portal (Task #7)

- 6 DB tables: `performance_cycles`, `performance_goals`, `goal_progress`, `self_appraisals`, `manager_evaluations`, `appraisal_outcomes`
- Backend routes: `routes/performance.ts` — cycles CRUD, advance-stage, goal CRUD, progress updates, self-appraisals (upsert), manager evaluations (upsert), calibration view with weighted scoring, outcome computation, ESS `/me` profile and dashboard
- Cycle stages: Goal Setting → Mid Review → Self Appraisal → Manager Evaluation → Calibration → Completed (advance-stage API increments stage)
- Cycle types: Annual, Semi-Annual, Quarterly; statuses: Draft, Active, Closed
- Goals (KRA/KPI): cycleId, employeeId, title, weightage (%), targetValue, measurementMethod, status; latest progress percent joined on list
- Calibration view aggregates self/manager scores per goal weighted by goal weightage; outcome labels: Outstanding, Exceeds Expectations, Meets Expectations, Needs Improvement, Unsatisfactory
- `computeAppraisalOutcomes` deletes and re-inserts outcomes for the cycle using manager rating (or self rating fallback) × goal weightage
- ESS portal: GET/PUT `/ess/me` (employee profile + emergency contact self-update), GET `/ess/dashboard` (attendance summary, leave balances, active goals, recent payslip)
- Frontend pages: `/performance` (cycles dashboard + quick-nav), `/performance/goals` (KRA/KPI list with progress bars + assign modal), `/performance/appraisals` (self-rating with star UI), `/performance/evaluations` (manager ratings for team), `/performance/calibration` (score matrix + outcome computation), `/ess` (3-tab hub: Dashboard / My Profile / Services)
- Role gates: HR creates cycles, HOD+ assigns goals, all roles access ESS, HR-only calibration

### Task #8: Helpdesk Ticketing + Document Generation
- DB tables: `helpdesk_tickets`, `ticket_comments`, `ticket_sla_logs`, `document_templates`, `issued_documents`
- Enum: `hrDocumentTypeEnum` (pg `hr_document_type`) — offer_letter, appointment_letter, experience_letter, salary_certificate, noc, increment_letter, relieving_letter, custom
- Backend routes: `/helpdesk` (CRUD + comments + SLA tracking + report) and `/documents` (templates CRUD + PDF generation via pdf-lib + download)
- SLA hours: Urgent=4, High=8, Medium=24, Low=48. Priority change resets SLA deadline.
- PDF generation: pdf-lib with `{{fieldName}}` substitution. Auto-fields: employeeName, employeeCode, dateOfJoining, lastWorkingDay, currentDate
- Frontend pages: `/helpdesk` (dashboard + create ticket + filters), `/helpdesk/ticket/:id` (detail + comments + status/priority controls), `/documents` (templates list + generate modal + issued documents)
- Role gates: Employees see own tickets; HOD sees team; HR unrestricted. Template management is HR-only. Internal comments restricted to MANAGER_ROLES.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec (NOTE: after running, manually ensure lib/api-zod/src/index.ts only has `export * from "./generated/api"`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Important Notes

- Orval codegen regenerates `lib/api-zod/src/index.ts` with duplicate exports. After every codegen run, ensure it only contains: `export * from "./generated/api";`
- The orval config intentionally omits `schemas: { type: "typescript" }` to prevent TypeScript type conflicts
- All protected routes use `requireAuth` middleware that checks Clerk auth
- Audit logs are written automatically on CRUD operations
- Demo data: 5 departments, 8 designations, 8 employees (seeded via SQL)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
