import fs from "node:fs";
import path from "node:path";
// @ts-ignore
import MarkdownIt from "/home/runner/workspace/node_modules/.pnpm/markdown-it@14.1.1/node_modules/markdown-it/index.mjs";
import { chromium } from "/home/runner/workspace/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const MD_PATH = path.resolve("docs/DEMO.md");
const OUT_PATH = path.resolve("docs/DEMO.pdf");
const DOC_DIR = path.dirname(MD_PATH);

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const raw = fs.readFileSync(MD_PATH, "utf8");
let html = md.render(raw);

html = html.replace(/<img\s+([^>]*?)src="([^"]+)"/g, (_m, pre, src) => {
  if (/^https?:|^data:|^\//.test(src)) return `<img ${pre}src="${src}"`;
  const abs = path.resolve(DOC_DIR, src);
  if (!fs.existsSync(abs)) return `<img ${pre}src="${src}"`;
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  const b64 = fs.readFileSync(abs).toString("base64");
  return `<img ${pre}src="data:image/${mime};base64,${b64}"`;
});

const fullHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>MysticsHR — Demo Documentation</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.55; }
  h1 { font-size: 26pt; color: #111827; border-bottom: 3px solid #f59e0b; padding-bottom: 8px; margin: 24px 0 12px; page-break-after: avoid; }
  h2 { font-size: 18pt; color: #111827; margin-top: 28px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; page-break-after: avoid; page-break-before: auto; }
  h3 { font-size: 13pt; color: #111827; margin-top: 18px; page-break-after: avoid; }
  p, li { font-size: 10.5pt; }
  a { color: #b45309; text-decoration: none; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 9.5pt; font-family: "SFMono-Regular", Menlo, Consolas, monospace; }
  pre { background: #0f172a; color: #f1f5f9; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 9pt; line-height: 1.45; }
  pre code { background: transparent; color: inherit; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10pt; page-break-inside: avoid; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  blockquote { border-left: 4px solid #f59e0b; background: #fffbeb; padding: 8px 14px; margin: 12px 0; color: #78350f; }
  img { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; margin: 8px 0 4px; display: block; page-break-inside: avoid; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  ul, ol { padding-left: 22px; }
  li { margin: 3px 0; }
</style></head><body>${html}</body></html>`;

const tmp = path.resolve("docs/.demo-pdf.html");
fs.writeFileSync(tmp, fullHtml);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + tmp, { waitUntil: "load" });
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: OUT_PATH,
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
});
await browser.close();
fs.unlinkSync(tmp);

const sizeKb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
console.log(`✓ wrote ${OUT_PATH} (${sizeKb} KB)`);
