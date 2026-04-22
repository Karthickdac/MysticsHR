/* eslint-disable no-console */
// @ts-ignore
import { chromium } from "/home/runner/workspace/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { createClerkClient } from "@clerk/express";
import path from "node:path";
import fs from "node:fs";

const BASE_URL =
  process.env.DEMO_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:19153");
const ROOT_OUT = path.resolve(process.cwd(), "docs/demo-screenshots");
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

type Shot = { path: string; file: string; title: string; waitMs?: number };

type RoleSpec = {
  key: string;
  email: string;
  display: string;
  description: string;
  shots: Shot[];
};

const COMMON_DASHBOARD: Shot = { path: "/dashboard", file: "01-dashboard.png", title: "Dashboard" };

const ROLES: RoleSpec[] = [
  {
    key: "super_admin",
    email: "arjun.sharma@automystics.com",
    display: "Super Admin (Arjun Sharma)",
    description:
      "Has access to every module. Use this account for full-system demos, configuration walkthroughs, and audit reviews.",
    shots: [
      COMMON_DASHBOARD,
      { path: "/employees", file: "02-employees.png", title: "Employee Directory" },
      { path: "/departments", file: "03-departments.png", title: "Departments" },
      { path: "/designations", file: "04-designations.png", title: "Designations" },
      { path: "/org-chart", file: "05-org-chart.png", title: "Org Chart" },
      { path: "/payroll", file: "06-payroll.png", title: "Payroll Runs" },
      { path: "/performance", file: "07-performance.png", title: "Performance Cycles" },
      { path: "/users", file: "08-users.png", title: "User Management" },
      { path: "/permissions", file: "09-permissions.png", title: "Role Permissions" },
      { path: "/audit-logs", file: "10-audit-logs.png", title: "Audit Log" },
      { path: "/settings", file: "11-settings.png", title: "System Settings" },
      { path: "/analytics", file: "12-analytics.png", title: "Analytics" },
    ],
  },
  {
    key: "hr_manager",
    email: "priya.v@automystics.com",
    display: "HR Manager (Priya Venkataraman)",
    description:
      "Owns the HR lifecycle: directory, onboarding, leave, performance, communications. Cannot touch payroll runs or system role configuration.",
    shots: [
      COMMON_DASHBOARD,
      { path: "/employees", file: "02-employees.png", title: "Employee Directory" },
      { path: "/employees/new", file: "03-new-employee.png", title: "Add New Employee" },
      { path: "/departments", file: "04-departments.png", title: "Departments" },
      { path: "/designations", file: "05-designations.png", title: "Designations" },
      { path: "/org-chart", file: "06-org-chart.png", title: "Org Chart" },
      { path: "/onboarding", file: "07-onboarding.png", title: "Onboarding Pipeline" },
      { path: "/pre-onboarding", file: "08-pre-onboarding.png", title: "Pre-onboarding" },
      { path: "/recruitment", file: "09-recruitment.png", title: "Recruitment" },
      { path: "/attendance/summary", file: "10-attendance-summary.png", title: "Attendance Summary" },
      { path: "/attendance/regularization", file: "11-regularization.png", title: "Regularization Approvals" },
      { path: "/leave/approvals", file: "12-leave-approvals.png", title: "Leave Approvals" },
      { path: "/leave/calendar", file: "13-leave-calendar.png", title: "Leave Calendar" },
      { path: "/leave/types", file: "14-leave-types.png", title: "Leave Types" },
      { path: "/leave/policies", file: "15-leave-policies.png", title: "Leave Policies" },
      { path: "/performance", file: "16-performance.png", title: "Performance Cycles" },
      { path: "/performance/goals", file: "17-goals.png", title: "Goals" },
      { path: "/performance/appraisals", file: "18-appraisals.png", title: "Appraisals" },
      { path: "/documents", file: "19-documents.png", title: "Documents" },
      { path: "/communications", file: "20-communications.png", title: "Communications" },
      { path: "/analytics", file: "21-analytics.png", title: "Analytics" },
      { path: "/reports", file: "22-reports.png", title: "Reports" },
    ],
  },
  {
    key: "payroll_admin",
    email: "ravi.kumar@automystics.com",
    display: "Payroll Admin (Ravi Kumar)",
    description:
      "Owns payroll execution end-to-end: salary structures, monthly runs, payslips, statutory reports, and tax declarations.",
    shots: [
      COMMON_DASHBOARD,
      { path: "/payroll", file: "02-payroll-runs.png", title: "Payroll Runs" },
      { path: "/payroll/salary-structures", file: "03-salary-structures.png", title: "Salary Structures" },
      { path: "/payroll/payslips", file: "04-payslips.png", title: "Payslips" },
      { path: "/payroll/reports", file: "05-payroll-reports.png", title: "Payroll Reports" },
      { path: "/payroll/tax-declaration", file: "06-tax-declaration.png", title: "Tax Declarations" },
      { path: "/employees", file: "07-employees.png", title: "Employee Directory (read)" },
    ],
  },
  {
    key: "hr_executive",
    email: "meena.r@automystics.com",
    display: "HR Executive (Meena Rajesh)",
    description:
      "Day-to-day HR operations: onboarding tasks, candidate coordination, helpdesk first-response, document issuance.",
    shots: [
      COMMON_DASHBOARD,
      { path: "/employees", file: "02-employees.png", title: "Employee Directory (read)" },
      { path: "/onboarding", file: "03-onboarding.png", title: "Onboarding Pipeline" },
      { path: "/pre-onboarding", file: "04-pre-onboarding.png", title: "Pre-onboarding" },
      { path: "/recruitment", file: "05-recruitment.png", title: "Recruitment" },
      { path: "/helpdesk", file: "06-helpdesk.png", title: "Helpdesk Tickets" },
      { path: "/documents", file: "07-documents.png", title: "Documents" },
    ],
  },
  {
    key: "hod",
    email: "suresh.b@automystics.com",
    display: "HOD (Suresh Babu)",
    description:
      "Department head focused on the team: see team members, approve leave, run mid-year and annual evaluations, monitor attendance.",
    shots: [
      COMMON_DASHBOARD,
      { path: "/employees", file: "02-team.png", title: "Team Members" },
      { path: "/org-chart", file: "03-org-chart.png", title: "Org Chart" },
      { path: "/attendance/summary", file: "04-attendance-summary.png", title: "Team Attendance Summary" },
      { path: "/leave/approvals", file: "05-leave-approvals.png", title: "Leave Approvals" },
      { path: "/leave/calendar", file: "06-leave-calendar.png", title: "Team Leave Calendar" },
      { path: "/performance", file: "07-performance.png", title: "Active Performance Cycle" },
      { path: "/performance/appraisals", file: "08-appraisals.png", title: "Team Appraisals" },
    ],
  },
  {
    key: "employee",
    email: "kavitha.n@automystics.com",
    display: "Employee — ESS (Kavitha Nair)",
    description:
      "Employee Self-Service. Marks attendance, applies for leave, sees payslips, raises helpdesk tickets, downloads documents.",
    shots: [
      COMMON_DASHBOARD,
      { path: "/ess", file: "02-ess.png", title: "ESS Hub" },
      { path: "/my-attendance", file: "03-my-attendance.png", title: "My Attendance" },
      { path: "/leave", file: "04-my-leave.png", title: "My Leave" },
      { path: "/leave/calendar", file: "05-leave-calendar.png", title: "Leave Calendar" },
      { path: "/helpdesk", file: "06-helpdesk.png", title: "My Helpdesk Tickets" },
      { path: "/documents", file: "07-documents.png", title: "My Documents" },
    ],
  },
];

async function main() {
  const onlyRole = process.env.ONLY_ROLE;
  const roles = onlyRole ? ROLES.filter((r) => r.key === onlyRole) : ROLES;
  if (roles.length === 0) {
    console.error(`No matching role for ONLY_ROLE=${onlyRole}`);
    process.exit(1);
  }

  fs.mkdirSync(ROOT_OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const role of roles) {
      console.log(`\n=== ${role.display} ===`);
      const outDir = path.join(ROOT_OUT, role.key);
      fs.mkdirSync(outDir, { recursive: true });

      // Find Clerk user by email
      const list = await clerk.users.getUserList({ emailAddress: [role.email] });
      const clerkUser = list.data[0];
      if (!clerkUser) {
        console.log(`  ✗ no clerk user for ${role.email}`);
        continue;
      }
      const ticketRes = await clerk.signInTokens.createSignInToken({
        userId: clerkUser.id,
        expiresInSeconds: 600,
      });
      const ticket = ticketRes.token;

      const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
      const page = await ctx.newPage();

      try {
        await page.goto(`${BASE_URL}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await page.waitForURL((u: URL) => !u.pathname.includes("/sign-in"), { timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        console.log("  ✓ signed in");
      } catch (e: any) {
        console.log(`  ✗ sign-in failed: ${String(e?.message ?? e).slice(0, 100)}`);
        await ctx.close();
        continue;
      }

      for (const shot of role.shots) {
        const dest = path.join(outDir, shot.file);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
          console.log(`  · ${shot.file} cached`);
          continue;
        }
        try {
          await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(shot.waitMs ?? 1200);
          await page.screenshot({ path: dest, fullPage: false });
          console.log(`  ✓ ${shot.path} → ${shot.file}`);
        } catch (e: any) {
          console.log(`  ✗ ${shot.path}: ${String(e?.message ?? e).slice(0, 100)}`);
        }
      }

      // Manifest
      fs.writeFileSync(
        path.join(outDir, "manifest.json"),
        JSON.stringify({ role: role.key, display: role.display, description: role.description, shots: role.shots }, null, 2),
      );

      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
