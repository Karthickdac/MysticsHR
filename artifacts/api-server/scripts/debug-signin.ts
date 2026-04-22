// @ts-ignore
import { chromium } from "/home/runner/workspace/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const BASE_URL = "http://localhost:19153";
const PASSWORD = "DemoTest123!@#";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on("console", (msg: any) => {
  const t = msg.text().slice(0, 200);
  if (msg.type() === "error" || t.includes("Clerk") || t.includes("auth")) {
    console.log(`[browser ${msg.type()}]`, t);
  }
});
page.on("response", (r: any) => {
  const u = r.url();
  if (u.includes("/api/") || u.includes("/auth/") || u.includes("clerk")) {
    console.log(`[net ${r.status()}]`, u.slice(0, 120));
  }
});

console.log("→ goto /sign-in");
await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
console.log("URL after load:", page.url());

console.log("→ filling identifier");
await page.fill('input[name="identifier"]', "priya.v@automystics.com");

const hasPwd = await page.$('input[name="password"]:visible');
console.log("Password visible already?", !!hasPwd);

if (!hasPwd) {
  console.log("→ clicking primary button to advance");
  await page.click('button[data-localization-key="formButtonPrimary"]');
  await page.waitForTimeout(2000);
  console.log("URL after continue:", page.url());
  await page.screenshot({ path: "/tmp/after-continue.png" });
}

await page.waitForSelector('input[name="password"]', { timeout: 15000 });
console.log("→ filling password");
await page.fill('input[name="password"]', PASSWORD);
await page.screenshot({ path: "/tmp/before-submit.png" });
console.log("→ clicking primary button to submit");
await page.click('button[data-localization-key="formButtonPrimary"]');

try {
  await page.waitForURL((url: URL) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 });
  console.log("✓ Redirected to:", page.url());
} catch (e: any) {
  console.log("✗ Did not redirect. Current URL:", page.url());
}

await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/final.png", fullPage: true });
console.log("Final URL:", page.url());

await browser.close();
