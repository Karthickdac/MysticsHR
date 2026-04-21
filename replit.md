# MysticsHR Workspace

## Overview

MysticsHR is a comprehensive Human Resource Management System (HRMS) designed for Automystics Technologies Private Limited. Its primary purpose is to manage the entire employee lifecycle within an organization, supporting six distinct role-based access levels. The project aims to provide a robust, scalable, and user-friendly platform for HR operations, covering recruitment, onboarding, employee management, attendance, leave, performance, and exit processes. The system is built as a pnpm monorepo using TypeScript, ensuring modularity and maintainability.

## User Preferences

I prefer iterative development with clear communication on progress and potential changes. Please ask before making any major architectural decisions or significant code overhauls. I value detailed explanations for complex implementations.

## System Architecture

MysticsHR is structured as a pnpm monorepo. The core technology stack includes:
- **Frontend**: React, Vite, Tailwind CSS, shadcn/ui, Wouter.
- **Backend**: Express 5.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Clerk.
- **Validation**: Zod.
- **API Codegen**: Orval (generates React Query hooks and Zod schemas from OpenAPI spec).

The project's directory structure segregates `lib` for shared components like API specifications, client-side API hooks, Zod schemas, and database configurations. `artifacts` contains the deployable units for the API server and the React frontend.

**Key Architectural Decisions & Features:**
- **Role-Based Access Control (RBAC)**: Supports `super_admin`, `hr_manager`, `hr_executive`, `hod`, `payroll_admin`, and `employee` roles, each with specific module access.
- **Modular Database Schema**: Designed with distinct tables for various HR functionalities (e.g., `employees`, `departments`, `designations`, `attendance_records`, `leave_applications`, `performance_cycles`, `helpdesk_tickets`).
- **Comprehensive API Design**: All API endpoints are under `/api` and cover CRUD operations, dashboard analytics, bulk imports, and workflow-specific actions for each HR module.
- **UI/UX**: Frontend pages are structured around HR workflows, including dashboards, employee directories, department/designation management, user administration, audit logs, and module-specific interfaces for recruitment, onboarding, shifts, attendance, leave, performance, helpdesk, and reporting. The UI utilizes Tailwind CSS and shadcn/ui for a consistent design.
- **Workflow Automation**: Includes automated processes for:
    - Onboarding: Auto-seeding tasks, calculating completion percentage, and generating ID cards (PDF with QR code).
    - Recruitment: Candidate stage auto-syncing based on interview/offer status, auto-creation of pre-onboarding records.
    - Leave/Permissions: Multi-level approval workflows, policy validations (balance, advance notice, blackout dates), and automatic balance updates.
    - Attendance: Automatic overtime calculation, regularization workflow, and HR override capabilities.
    - Performance: Lifecycle management for performance cycles, goal tracking, self/manager appraisals, and outcome computation with weighted scoring.
    - Exit: Auto-generation of clearance tasks, dual-approval for FNF, and auto-issuance of exit documents.
- **Document Generation**: Utilizes `pdf-lib` for generating dynamic PDFs (e.g., ID cards, offer letters, relieving letters) with template substitution.
- **Reporting & Analytics**: Features an analytics dashboard with KPIs (headcount, attrition, attendance), pre-built reports, a custom report builder, and a report scheduler.
- **Helpdesk Ticketing**: Implements ticket management with comments, SLA tracking, and role-based visibility.
- **Field-level Auditing**: `employee_history` table records changes to employee profiles for audit trails.
- **Atomicity**: All critical mutations are wrapped in database transactions to ensure data consistency.

## External Dependencies

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Authentication**: Clerk (`@clerk/express`, `@clerk/react`)
- **UI Component Library**: shadcn/ui
- **PDF Generation**: `pdf-lib`
- **QR Code Generation**: `qrcode`
- **API Client Generation**: Orval
- **Data Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Charting**: Recharts (for analytics dashboard)
- **Deployment**: Leverages `esbuild` for CJS bundle.