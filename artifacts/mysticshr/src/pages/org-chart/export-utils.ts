import { toPng } from "html-to-image";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const COMPANY_NAME = "Automystics Technologies";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayHuman(): string {
  return new Date().toLocaleDateString("en-IN", {
    year: "numeric", month: "short", day: "2-digit",
  });
}

export function buildExportFilename(scope: string, ext: "png" | "pdf"): string {
  const safeScope = (scope || "all").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "all";
  return `org-chart-${safeScope}-${todayIso()}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Wait for every <img> inside a node to finish loading (or error out), so
 * the snapshot doesn't capture half-rendered avatar placeholders. We cap the
 * wait to keep the export from hanging forever on a slow/broken image.
 */
async function waitForImages(node: HTMLElement, timeoutMs = 4000): Promise<void> {
  const imgs = Array.from(node.querySelectorAll("img"));
  if (imgs.length === 0) return;
  const settle = (img: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      const done = () => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        resolve();
      };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  await Promise.race([
    Promise.all(imgs.map(settle)).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

/**
 * Snapshot a DOM node to a PNG dataURL. We pin pixel ratio to 2 for crisp
 * output and force the captured node's full scrollable size so very wide org
 * charts are not clipped to the viewport.
 */
async function snapshotNode(node: HTMLElement): Promise<{ dataUrl: string; width: number; height: number }> {
  await waitForImages(node);
  const width = Math.max(node.scrollWidth, node.clientWidth);
  const height = Math.max(node.scrollHeight, node.clientHeight);
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    width, height,
    style: {
      // Override any flex/inline-block constraints that prevent the node from
      // expanding to its scroll size during capture.
      width: `${width}px`,
      height: `${height}px`,
    },
    cacheBust: true,
  });
  return { dataUrl, width, height };
}

export async function exportOrgChartPng(node: HTMLElement, scope: string): Promise<void> {
  const { dataUrl } = await snapshotNode(node);
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  triggerDownload(blob, buildExportFilename(scope, "png"));
}

/**
 * Build a paginated A4-landscape PDF from a single PNG snapshot of the chart.
 * The PNG is fitted to the page width and sliced vertically across pages so
 * tall charts produce multiple pages rather than one huge unreadable page.
 * Each page carries a header with the company name and a footer with the
 * scope, page number, and export date.
 */
export async function exportOrgChartPdf(node: HTMLElement, scope: string): Promise<void> {
  const { dataUrl, width: pxW, height: pxH } = await snapshotNode(node);
  const pngBytes = await (await fetch(dataUrl)).arrayBuffer();

  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const png = await pdf.embedPng(pngBytes);

  // A4 landscape with chrome reserved for header + footer.
  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const margin = 36;
  const headerH = 36;
  const footerH = 24;
  const contentW = PAGE_W - margin * 2;
  const contentH = PAGE_H - margin * 2 - headerH - footerH;

  // Compute scale so the snapshot fits the content width, then determine how
  // many vertical pages are needed for the resulting scaled height.
  const scale = contentW / pxW;
  const scaledH = pxH * scale;
  const pageCount = Math.max(1, Math.ceil(scaledH / contentH));

  const dateStr = todayHuman();
  const scopeLabel = scope || "All employees";

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);

    // Header
    page.drawText(COMPANY_NAME, {
      x: margin, y: PAGE_H - margin - 4,
      size: 13, font: bold, color: rgb(0.1, 0.1, 0.4),
    });
    page.drawText("Organization Chart", {
      x: margin, y: PAGE_H - margin - 20,
      size: 9, font: regular, color: rgb(0.4, 0.4, 0.4),
    });
    page.drawLine({
      start: { x: margin, y: PAGE_H - margin - headerH + 4 },
      end:   { x: PAGE_W - margin, y: PAGE_H - margin - headerH + 4 },
      thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
    });

    // Slice the source PNG vertically. pdf-lib doesn't crop, so we draw the
    // full image at its scaled size shifted upward by `pageIdx * contentH`
    // and clip via a covering white rectangle outside the content band.
    const imgX = margin;
    const imgYBottomFullPage = PAGE_H - margin - headerH - scaledH + pageIdx * contentH;
    page.drawImage(png, {
      x: imgX,
      y: imgYBottomFullPage,
      width: contentW,
      height: scaledH,
    });
    // Mask above the content band
    page.drawRectangle({
      x: 0, y: PAGE_H - margin - headerH,
      width: PAGE_W, height: margin + headerH,
      color: rgb(1, 1, 1),
    });
    // Mask below the content band
    page.drawRectangle({
      x: 0, y: 0,
      width: PAGE_W, height: margin + footerH,
      color: rgb(1, 1, 1),
    });
    // Re-draw header chrome that the top mask wiped, so it stays on top.
    page.drawText(COMPANY_NAME, {
      x: margin, y: PAGE_H - margin - 4,
      size: 13, font: bold, color: rgb(0.1, 0.1, 0.4),
    });
    page.drawText("Organization Chart", {
      x: margin, y: PAGE_H - margin - 20,
      size: 9, font: regular, color: rgb(0.4, 0.4, 0.4),
    });
    page.drawLine({
      start: { x: margin, y: PAGE_H - margin - headerH + 4 },
      end:   { x: PAGE_W - margin, y: PAGE_H - margin - headerH + 4 },
      thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
    });

    // Footer
    const fy = margin;
    page.drawLine({
      start: { x: margin, y: fy + footerH - 4 },
      end:   { x: PAGE_W - margin, y: fy + footerH - 4 },
      thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
    });
    page.drawText(`${COMPANY_NAME} · ${scopeLabel} · Exported ${dateStr}`, {
      x: margin, y: fy + 4,
      size: 8, font: regular, color: rgb(0.5, 0.5, 0.5),
    });
    const pageLabel = `Page ${pageIdx + 1} of ${pageCount}`;
    const pageLabelWidth = regular.widthOfTextAtSize(pageLabel, 8);
    page.drawText(pageLabel, {
      x: PAGE_W - margin - pageLabelWidth, y: fy + 4,
      size: 8, font: regular, color: rgb(0.5, 0.5, 0.5),
    });
  }

  const bytes = await pdf.save();
  // pdf-lib returns a Uint8Array; copy into a fresh ArrayBuffer so the Blob
  // type signature is happy under strict TS lib settings.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "application/pdf" });
  triggerDownload(blob, buildExportFilename(scope, "pdf"));
}
