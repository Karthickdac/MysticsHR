/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
// @ts-ignore
import MarkdownIt from "/home/runner/workspace/node_modules/.pnpm/markdown-it@14.1.1/node_modules/markdown-it/index.mjs";
// @ts-ignore
import { chromium } from "/home/runner/workspace/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const ROOT = path.resolve("docs/demo-screenshots");
const OUT_DIR = path.resolve("docs/role-demos");
fs.mkdirSync(OUT_DIR, { recursive: true });

type Manifest = {
  role: string;
  display: string;
  description: string;
  shots: { path: string; file: string; title: string }[];
};

const ROLE_FLOWS: Record<string, string[]> = {
  super_admin: [
    "Tour the dashboard, then `/users` and `/permissions` to show the role matrix.",
    "Open `/audit-logs` and walk through who-changed-what for the latest payroll run.",
    "Step into `/settings` to review organisation-wide configuration.",
  ],
  hr_manager: [
    "Create a new employee at `/employees/new`; the onboarding checklist auto-generates.",
    "Approve the seeded leave request at `/leave/approvals` and show the calendar update.",
    "Walk through the active cycle at `/performance`, drill into goals and appraisals.",
    "Send an announcement from `/communications`.",
  ],
  payroll_admin: [
    "Open the draft run at `/payroll`, click Calculate, then Lock.",
    "Drill into a payslip from `/payroll/payslips` and download it.",
    "Show statutory outputs at `/payroll/reports` and tax declarations at `/payroll/tax-declaration`.",
  ],
  hr_executive: [
    "Move an onboarding task to Done from `/onboarding` for the latest joiner.",
    "Pick a ticket from `/helpdesk`, add a comment, change status to In Progress.",
    "Issue an Experience Letter from `/documents`.",
  ],
  hod: [
    "Review the team via `/employees` (filtered to direct reports).",
    "Approve a pending leave at `/leave/approvals`.",
    "Submit a manager evaluation from `/performance/appraisals`.",
  ],
  employee: [
    "Clock in from `/my-attendance`.",
    "Apply for 2 days of casual leave at `/leave`.",
    "Download the latest payslip and raise a helpdesk ticket from `/helpdesk`.",
  ],
};

const ROLE_ORDER = ["super_admin", "hr_manager", "payroll_admin", "hr_executive", "hod", "employee"];

const ROLE_EMAIL: Record<string, string> = {
  super_admin: "arjun.sharma@automystics.com",
  hr_manager: "priya.v@automystics.com",
  payroll_admin: "ravi.kumar@automystics.com",
  hr_executive: "meena.r@automystics.com",
  hod: "suresh.b@automystics.com",
  employee: "kavitha.n@automystics.com",
};

function buildMarkdown(m: Manifest): string {
  const flows = ROLE_FLOWS[m.role] ?? [];
  const lines: string[] = [];
  lines.push(`# ${m.display} — Demo`);
  lines.push("");
  lines.push(`**Sign-in:** \`${ROLE_EMAIL[m.role]}\` · **Password:** \`DemoTest123!@#\``);
  lines.push("");
  lines.push(m.description);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Screens this role sees");
  lines.push("");
  for (const s of m.shots) {
    lines.push(`### ${s.title}`);
    lines.push("");
    lines.push(`Route: \`${s.path}\``);
    lines.push("");
    lines.push(`![${s.title}](../demo-screenshots/${m.role}/${s.file})`);
    lines.push("");
  }
  if (flows.length) {
    lines.push("---");
    lines.push("");
    lines.push("## Suggested demo flow");
    lines.push("");
    flows.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
    lines.push("");
  }
  return lines.join("\n");
}

function renderHtml(md: string, docDir: string): string {
  const it = new MarkdownIt({ html: true, linkify: true, typographer: true });
  let html = it.render(md);
  html = html.replace(/<img\s+([^>]*?)src="([^"]+)"/g, (_m, pre, src) => {
    if (/^https?:|^data:|^\//.test(src)) return `<img ${pre}src="${src}"`;
    const abs = path.resolve(docDir, src);
    if (!fs.existsSync(abs)) return `<img ${pre}src="${src}"`;
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext;
    const b64 = fs.readFileSync(abs).toString("base64");
    return `<img ${pre}src="data:image/${mime};base64,${b64}"`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.55; }
    h1 { font-size: 24pt; color: #111827; border-bottom: 3px solid #f59e0b; padding-bottom: 6px; margin: 8px 0 14px; }
    h2 { font-size: 16pt; color: #111827; margin-top: 24px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; page-break-after: avoid; }
    h3 { font-size: 12pt; color: #111827; margin-top: 16px; page-break-after: avoid; }
    p, li { font-size: 10.5pt; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 9.5pt; font-family: "SFMono-Regular", Menlo, Consolas, monospace; }
    img { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; margin: 6px 0 14px; display: block; page-break-inside: avoid; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 18px 0; }
    ul, ol { padding-left: 22px; }
    li { margin: 3px 0; }
  </style></head><body>${html}</body></html>`;
}

async function main() {
  const browser = await chromium.launch();
  try {
    for (const roleKey of ROLE_ORDER) {
      const dir = path.join(ROOT, roleKey);
      const manifestPath = path.join(dir, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        console.log(`skip ${roleKey} (no manifest)`);
        continue;
      }
      const m: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const md = buildMarkdown(m);
      const mdPath = path.join(OUT_DIR, `${roleKey}.md`);
      fs.writeFileSync(mdPath, md);

      const html = renderHtml(md, OUT_DIR);
      const tmpHtml = path.join(OUT_DIR, `.${roleKey}.html`);
      fs.writeFileSync(tmpHtml, html);

      const pdfPath = path.join(OUT_DIR, `${roleKey}.pdf`);
      const page = await browser.newPage();
      await page.goto("file://" + tmpHtml, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.pdf({
        path: pdfPath,
        format: "A4",
        printBackground: true,
        margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      });
      await page.close();
      fs.unlinkSync(tmpHtml);

      const sizeKb = (fs.statSync(pdfPath).size / 1024).toFixed(0);
      console.log(`✓ ${roleKey}.pdf (${sizeKb} KB) + ${roleKey}.md`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
