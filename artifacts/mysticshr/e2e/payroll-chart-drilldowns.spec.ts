import { test, expect, type Page } from "@playwright/test";

const HARNESS_PATH = "/__test/payroll-chart";
const REPORTS_HARNESS_PATH = "/__test/payroll-reports";

async function gotoChartHarness(page: Page) {
  await page.goto(HARNESS_PATH);
  await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 15_000 });
  await page.waitForSelector('[data-testid="payroll-chart-harness"] svg.recharts-surface', { timeout: 15_000 });
  await page.waitForTimeout(150);
}

async function readNavigateLog(page: Page): Promise<string[]> {
  return await page.evaluate(() => window.__navigateLog ?? []);
}

async function clearNavigateLog(page: Page): Promise<void> {
  await page.evaluate(() => { window.__navigateLog = []; });
}

test.describe("Payroll cost chart drill-downs", () => {
  test("monthly Net Cost bar navigates to a non-Draft/Computed payroll run", async ({ page }) => {
    await gotoChartHarness(page);
    // The 'Headcount vs Cost' ComposedChart has 12 monthly Net Cost bars.
    // Scope bars to that specific chart card to avoid hitting the statutory bars.
    const monthlyChart = page.locator('.recharts-wrapper').nth(1); // 0=line, 1=composed, 2=pie, 3=statutory
    const monthlyBars = monthlyChart.locator('.recharts-bar-rectangle path');
    await expect.poll(async () => monthlyBars.count()).toBe(12);

    // Mar 2026 (last) → Locked run #1001
    await monthlyBars.nth(11).click({ force: true });
    await expect.poll(async () => readNavigateLog(page)).toContain("/payroll/runs/1001");

    // Jan 2026 (index 9) → Locked #1005, NOT Computed #1004
    await clearNavigateLog(page);
    await monthlyBars.nth(9).click({ force: true });
    await expect.poll(async () => readNavigateLog(page)).toContain("/payroll/runs/1005");
    const janLog = await readNavigateLog(page);
    expect(janLog).not.toContain("/payroll/runs/1004");

    // Dec 2025 (index 8) → only Draft #1006 → must NOT navigate
    await clearNavigateLog(page);
    await monthlyBars.nth(8).click({ force: true });
    await page.waitForTimeout(400);
    expect(await readNavigateLog(page)).toEqual([]);
  });

  test("statutory bar click navigates AND the reports page auto-fetches the report", async ({ page }) => {
    // ---- Part A: chart click produces correct query string ----
    await gotoChartHarness(page);
    const allBars = page.locator('.recharts-bar-rectangle path');
    const total = await allBars.count();
    expect(total).toBeGreaterThanOrEqual(18);

    // PF (Employee) is bar (total - 6); TDS is the last bar.
    await allBars.nth(total - 1).click({ force: true });
    await expect.poll(async () => readNavigateLog(page)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/payroll\/reports\?.*type=tds/)]),
    );

    await clearNavigateLog(page);
    await allBars.nth(total - 6).click({ force: true });
    await expect.poll(async () => readNavigateLog(page)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/payroll\/reports\?.*type=pf-ecr/)]),
    );

    const log = await readNavigateLog(page);
    const pfUrl = log.find(u => u.includes("type=pf-ecr"))!;
    expect(pfUrl).toMatch(/toYear=2026/);
    expect(pfUrl).toMatch(/toMonth=3/);
    expect(pfUrl).toMatch(/fromMonth=4/);
    expect(pfUrl).toMatch(/filterMode=range/);

    // ---- Part B: arriving at /payroll/reports with those params auto-fetches ----
    // Stub the PF ECR report endpoint so the harness has data to render
    // without needing the real DB / auth provisioning.
    await page.route("**/api/payroll/reports/pf-ecr**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          period: "Apr 2025 — Mar 2026",
          summary: { totalEmployeeContribution: "144000.00", totalEmployerContribution: "144000.00", totalEmployees: 12 },
          records: [
            { employeeCode: "AMT-2024-001", employeeName: "Arjun Sharma", basic: "60000", pfEmployee: "7200", pfEmployer: "7200" },
            { employeeCode: "AMT-2024-002", employeeName: "Priya Venkataraman", basic: "55000", pfEmployee: "6600", pfEmployer: "6600" },
          ],
        }),
      });
    });

    // Replay the URL the chart click emitted, against the reports harness.
    const search = pfUrl.slice(pfUrl.indexOf("?"));
    await page.goto(`${REPORTS_HARNESS_PATH}${search}`);
    await page.waitForFunction(() => window.__reportsHarnessReady === true, null, { timeout: 15_000 });

    // The reports page auto-fetches on mount when valid query params are present.
    // Assert the placeholder is GONE and a record row from the stubbed payload appears.
    const placeholder = page.getByText(/Select period and click Generate Report/i);
    await expect(placeholder).toHaveCount(0, { timeout: 10_000 });

    const harness = page.locator('[data-testid="payroll-reports-harness"]');
    await expect(harness).toContainText("Arjun Sharma", { timeout: 10_000 });
    await expect(harness).toContainText(/PF Employee/);
  });

  test("department pie slice opens drilldown dialog with payroll record rows", async ({ page }) => {
    // Stub the records endpoint BEFORE loading the harness so the dialog's
    // useGetPayrollRunRecords(1001) returns data immediately when the dialog opens.
    await page.route("**/api/payroll/runs/1001/records**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: 9001, employeeId: 1, employeeCode: "AMT-2024-001", employeeName: "Arjun Sharma", departmentId: 1, departmentName: "Engineering", grossEarnings: "120000", totalDeductions: "30000", netPay: "90000" },
          { id: 9002, employeeId: 3, employeeCode: "AMT-2024-003", employeeName: "Vikram Iyer",   departmentId: 1, departmentName: "Engineering", grossEarnings: "110000", totalDeductions: "28000", netPay: "82000" },
          { id: 9003, employeeId: 2, employeeCode: "AMT-2024-002", employeeName: "Priya Venkataraman", departmentId: 2, departmentName: "Human Resources", grossEarnings: "95000",  totalDeductions: "22000", netPay: "73000"  },
        ]),
      });
    });

    await gotoChartHarness(page);

    const sectors = page.locator('.recharts-pie-sector path');
    await expect(sectors.first()).toBeVisible();
    expect(await sectors.count()).toBeGreaterThanOrEqual(3);

    // dispatchEvent bypasses Recharts' continuous sector animations.
    await sectors.first().dispatchEvent("click");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText(/March 2026/);
    // Engineering is the first dept in the fixture; assert its name in the dialog title.
    await expect(dialog).toContainText(/Engineering/);

    // The dialog must render the payroll records filtered to the clicked department.
    // 2 of the 3 stubbed records belong to Engineering; both should appear.
    await expect(dialog).toContainText("Arjun Sharma", { timeout: 10_000 });
    await expect(dialog).toContainText("Vikram Iyer");
    await expect(dialog).toContainText("AMT-2024-001");
    // Priya is HR — must NOT leak through department-scoped filter.
    await expect(dialog).not.toContainText("Priya Venkataraman");

    // Pie click must NOT trigger navigation (it opens a dialog instead).
    const log = await readNavigateLog(page);
    expect(log.filter(u => u.startsWith("/payroll"))).toEqual([]);
  });
});
