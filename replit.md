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
