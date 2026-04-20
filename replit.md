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
- `GET|PUT|DELETE /api/employees/:id` — get/update/delete employee
- `PATCH /api/employees/:id/status` — update employee status
- `GET|POST /api/users` — list/create HRMS users
- `GET /api/users/me` — current user profile
- `GET|PUT /api/users/:id` — get/update user
- `GET /api/audit-logs` — list audit logs

## Frontend Pages (artifacts/mysticshr/src/)

- `/` — Landing page (public, redirects to /dashboard if signed in)
- `/sign-in` — Clerk sign-in (custom branded)
- `/sign-up` — Clerk sign-up (custom branded)
- `/dashboard` — KPI tiles, charts, activity feed
- `/employees` — Employee directory with search/filter/pagination
- `/employees/:id` — Employee detail with tabs
- `/employees/new` — New employee (placeholder)
- `/departments` — Dept management with create/edit/delete
- `/designations` — Designation management with create/edit/delete
- `/users` — User account management (Super Admin)
- `/audit-logs` — Audit log viewer with table + filter
- `/settings` — Settings placeholder

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
