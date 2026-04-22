// @ts-ignore - resolved at runtime via absolute path
import { chromium, type Page } from "/home/runner/workspace/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { createClerkClient } from "@clerk/express";
import path from "node:path";
import fs from "node:fs";

const BASE_URL =
  process.env.DEMO_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:19153");
const OUT_DIR = path.resolve(process.cwd(), "docs/demo-screenshots");
const PASSWORD = "DemoTest123!@#";
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

const USERS = {
  super_admin: { email: "arjun.sharma@automystics.com", name: "Arjun Sharma" },
  hr_manager: { email: "priya.v@automystics.com", name: "Priya Venkataraman" },
  payroll_admin: { email: "ravi.kumar@automystics.com", name: "Ravi Kumar" },
  hr_executive: { email: "meena.r@automystics.com", name: "Meena Rajesh" },
  hod: { email: "suresh.b@automystics.com", name: "Suresh Babu" },
  employee: { email: "kavitha.n@automystics.com", name: "Kavitha Nair" },
} as const;

type RoleKey = keyof typeof USERS;

interface Shot {
  role: RoleKey;
  path: string;
  file: string;
  caption: string;
  waitMs?: number;
}

const SHOTS: Shot[] = [
  // 1. Employees
  { role: "hr_manager", path: "/dashboard", file: "01-dashboard.png", caption: "HR Manager dashboard with KPIs and recent activity" },
  { role: "hr_manager", path: "/employees", file: "02-employees-list.png", caption: "Employee directory" },
  { role: "hr_manager", path: "/employees/new", file: "03-employees-new.png", caption: "New employee creation form" },
  { role: "hr_manager", path: "/departments", file: "04-departments.png", caption: "Departments management" },
  { role: "hr_manager", path: "/designations", file: "05-designations.png", caption: "Designations management" },
  { role: "hr_manager", path: "/org-chart", file: "06-org-chart.png", caption: "Organisation chart" },

  // 2. Onboarding
  { role: "hr_executive", path: "/onboarding", file: "07-onboarding-list.png", caption: "Onboarding pipeline" },
  { role: "hr_executive", path: "/pre-onboarding", file: "08-pre-onboarding.png", caption: "Pre-onboarding queue" },
  { role: "hr_executive", path: "/recruitment", file: "09-recruitment.png", caption: "Recruitment requisitions and candidates" },

  // 3. Attendance & Shifts
  { role: "employee", path: "/my-attendance", file: "10-my-attendance.png", caption: "Employee self-service attendance with clock in/out" },
  { role: "hr_manager", path: "/attendance/summary", file: "11-attendance-summary.png", caption: "Attendance summary across employees" },
  { role: "hr_manager", path: "/attendance/regularization", file: "12-attendance-regularization.png", caption: "Attendance regularization requests" },
  { role: "hr_manager", path: "/shifts", file: "13-shifts.png", caption: "Shift templates and assignments" },
  { role: "hr_manager", path: "/shifts/calendar", file: "14-shifts-calendar.png", caption: "Shift calendar view" },

  // 4. Leave
  { role: "employee", path: "/leave", file: "15-leave-employee.png", caption: "Employee leave balances and applications" },
  { role: "hr_manager", path: "/leave/approvals", file: "16-leave-approvals.png", caption: "Leave approvals queue" },
  { role: "hr_manager", path: "/leave/calendar", file: "17-leave-calendar.png", caption: "Team leave calendar" },
  { role: "hr_manager", path: "/leave/types", file: "18-leave-types.png", caption: "Leave types configuration" },
  { role: "hr_manager", path: "/leave/policies", file: "19-leave-policies.png", caption: "Leave policies" },

  // 5. Payroll
  { role: "payroll_admin", path: "/payroll", file: "20-payroll-runs.png", caption: "Payroll runs (locked + draft)" },
  { role: "payroll_admin", path: "/payroll/salary-structures", file: "21-payroll-salary-structures.png", caption: "Salary structures and components" },
  { role: "payroll_admin", path: "/payroll/payslips", file: "22-payroll-payslips.png", caption: "Generated payslips" },
  { role: "payroll_admin", path: "/payroll/reports", file: "23-payroll-reports.png", caption: "Payroll reports" },
  { role: "payroll_admin", path: "/payroll/tax-declaration", file: "24-payroll-tax-declaration.png", caption: "Employee tax declarations" },

  // 6. Performance
  { role: "hr_manager", path: "/performance", file: "25-performance.png", caption: "Active performance cycles" },
  { role: "hr_manager", path: "/performance/goals", file: "26-performance-goals.png", caption: "Goals across the org" },
  { role: "hr_manager", path: "/performance/appraisals", file: "27-performance-appraisals.png", caption: "Self-appraisal and manager evaluation status" },
  { role: "hr_manager", path: "/performance/calibration", file: "28-performance-calibration.png", caption: "Rating calibration" },

  // 7. Helpdesk
  { role: "hr_executive", path: "/helpdesk", file: "29-helpdesk-list.png", caption: "Helpdesk tickets across all statuses" },
  { role: "hr_executive", path: "/helpdesk/sla-report", file: "30-helpdesk-sla.png", caption: "SLA compliance report" },

  // 8. Documents
  { role: "hr_manager", path: "/documents", file: "31-documents.png", caption: "Document templates and issued documents" },

  // 9. Communications, Reports, System Config
  { role: "super_admin", path: "/communications", file: "32-communications.png", caption: "Communications and notifications hub" },
  { role: "super_admin", path: "/analytics", file: "33-analytics.png", caption: "Analytics dashboard" },
  { role: "super_admin", path: "/reports", file: "34-reports.png", caption: "Reports library" },
  { role: "super_admin", path: "/audit-logs", file: "35-audit-logs.png", caption: "Audit trail" },
  { role: "super_admin", path: "/users", file: "36-users.png", caption: "User & role management" },
  { role: "super_admin", path: "/permissions", file: "37-permissions.png", caption: "Role permissions matrix" },
  { role: "super_admin", path: "/settings", file: "38-settings.png", caption: "System configuration" },

  // ESS
  { role: "employee", path: "/ess", file: "39-ess.png", caption: "Employee self-service hub" },
];

async function getSignInTicket(email: string): Promise<string> {
  const list = await clerk.users.getUserList({ emailAddress: [email] });
  const user = list.data[0];
  if (!user) throw new Error(`No Clerk user for ${email}`);
  // @ts-ignore - signInTokens is exposed at runtime on backend client
  const token = await clerk.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 600 });
  return token.token;
}

async function fillOtpIfPresent(page: Page) {
  // Clerk's dev mode accepts "424242" as the magic verification code
  const otpVisible = await page.$('input[inputmode="numeric"], input[name="code"], input[id^="otp-input"]').then(Boolean).catch(() => false);
  if (otpVisible) {
    const code = "424242";
    // Clerk renders 6 individual inputs; fill each
    const inputs = await page.$$('input[inputmode="numeric"], input[id^="otp-input"]');
    if (inputs.length >= 6) {
      for (let i = 0; i < 6; i++) {
        await inputs[i].fill(code[i]);
      }
    } else {
      // Single combined input
      const single = await page.$('input[name="code"], input[inputmode="numeric"]');
      if (single) await single.fill(code);
    }
    // Click continue / verify
    const submit = await page.$('button[data-localization-key="formButtonPrimary"]');
    if (submit) await submit.click();
  }
}

async function signIn(page: Page, email: string) {
  // Use Clerk Backend SDK to mint a one-time sign-in ticket; bypasses OTP and password.
  const ticket = await getSignInTicket(email);
  // Visit /sign-in with __clerk_ticket which Clerk auto-consumes on mount
  await page.goto(`${BASE_URL}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForURL((url: URL) => !url.pathname.startsWith("/sign-in"), { timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // Use one sign-in (super_admin) for all shots — sees every module.
  const byRole = new Map<RoleKey, Shot[]>();
  byRole.set("super_admin", SHOTS.map((s) => ({ ...s, role: "super_admin" as RoleKey })));

  const captured: Array<{ shot: Shot; ok: boolean; err?: string }> = [];

  for (const [role, shots] of byRole.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const user = USERS[role];
    console.log(`\n→ Signing in as ${role} (${user.email})`);
    try {
      await signIn(page, user.email);
      console.log(`  ✓ signed in`);
    } catch (e: any) {
      console.log(`  ✗ sign-in failed: ${e?.message ?? e}`);
      await ctx.close();
      for (const s of shots) captured.push({ shot: s, ok: false, err: "sign-in failed" });
      continue;
    }

    for (const shot of shots) {
      const dest = path.join(OUT_DIR, shot.file);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
        console.log(`  · ${shot.file} already captured, skipping`);
        captured.push({ shot, ok: true });
        continue;
      }
      try {
        await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(shot.waitMs ?? 1200);
        await page.screenshot({ path: dest, fullPage: false });
        console.log(`  ✓ ${shot.path} → ${shot.file}`);
        captured.push({ shot, ok: true });
      } catch (e: any) {
        console.log(`  ✗ ${shot.path}: ${String(e?.message ?? e).slice(0, 100)}`);
        captured.push({ shot, ok: false, err: String(e?.message ?? e) });
      }
    }

    await ctx.close();
  }

  await browser.close();

  // Write index json
  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(captured.map((c) => ({ ...c.shot, ok: c.ok, err: c.err })), null, 2),
  );

  const okCount = captured.filter((c) => c.ok).length;
  console.log(`\nCaptured ${okCount}/${captured.length} screenshots → ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
