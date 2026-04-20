import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Replace {{fieldName}} placeholders in a template string */
export function substituteTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key] ?? `[${key}]`);
}

export interface GeneratePdfOptions {
  companyName: string;
  companyAddress: string;
  headerText: string;
  footerText: string;
  bodyText: string;
  title: string;
}

/** Generate an A4 PDF with Automystics Technologies letterhead. Returns a Buffer. */
export async function generatePdf(opts: GeneratePdfOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  const margin = 50;
  const lineHeight = 16;

  let y = height - margin;

  page.drawText(opts.companyName || "Automystics Technologies", {
    x: margin, y, size: 16, font: boldFont, color: rgb(0.1, 0.1, 0.4),
  });
  y -= lineHeight * 1.5;

  page.drawText(opts.companyAddress || "", {
    x: margin, y, size: 9, font: regularFont, color: rgb(0.4, 0.4, 0.4),
  });
  y -= lineHeight;

  if (opts.headerText) {
    page.drawText(opts.headerText, {
      x: margin, y, size: 9, font: regularFont, color: rgb(0.4, 0.4, 0.4),
    });
    y -= lineHeight;
  }

  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= lineHeight * 1.5;

  page.drawText(opts.title, {
    x: margin, y, size: 14, font: boldFont, color: rgb(0.1, 0.1, 0.3),
  });
  y -= lineHeight * 2;

  const bodyLines = opts.bodyText.split("\n");
  for (const rawLine of bodyLines) {
    const words = rawLine.split(" ");
    let currentLine = "";
    const maxWidth = width - margin * 2;

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = regularFont.widthOfTextAtSize(testLine, 11);
      if (testWidth > maxWidth && currentLine) {
        if (y < margin + 60) break;
        page.drawText(currentLine, { x: margin, y, size: 11, font: regularFont, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine && y >= margin + 60) {
      page.drawText(currentLine, { x: margin, y, size: 11, font: regularFont, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    } else {
      y -= lineHeight * 0.3;
    }
  }

  y = margin + 40;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= lineHeight;
  if (opts.footerText) {
    page.drawText(opts.footerText, { x: margin, y, size: 8, font: regularFont, color: rgb(0.5, 0.5, 0.5) });
  }
  page.drawText(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, {
    x: width - margin - 150, y, size: 8, font: regularFont, color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export interface GenerateTablePdfOptions {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/** Generate a landscape A4 report PDF with Automystics Technologies letterhead and a data table. */
export async function generateTablePdf(opts: GenerateTablePdfOptions): Promise<Buffer> {
  // A4 landscape
  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const margin = 36;
  const usableW = PAGE_W - margin * 2;
  const ROW_H = 14;
  const COL_COUNT = opts.headers.length;
  const colW = COL_COUNT > 0 ? Math.floor(usableW / COL_COUNT) : usableW;
  const HEADER_ROWS_PER_PAGE = 1;
  const ROWS_PER_PAGE = Math.floor((PAGE_H - margin * 2 - 80) / ROW_H) - HEADER_ROWS_PER_PAGE;

  function drawPageHeader(page: ReturnType<typeof pdfDoc.addPage>, isFirst: boolean) {
    let y = PAGE_H - margin;
    // Company letterhead
    page.drawText("Automystics Technologies", { x: margin, y, size: 13, font: boldFont, color: rgb(0.1, 0.1, 0.4) });
    y -= 14;
    page.drawText("Internal HR Management System — MysticsHR", { x: margin, y, size: 8, font: regularFont, color: rgb(0.5, 0.5, 0.5) });
    y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: PAGE_W - margin, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
    y -= 14;
    if (isFirst) {
      page.drawText(opts.title, { x: margin, y, size: 12, font: boldFont, color: rgb(0.1, 0.1, 0.3) });
      y -= 12;
      if (opts.subtitle) {
        page.drawText(opts.subtitle, { x: margin, y, size: 8, font: regularFont, color: rgb(0.5, 0.5, 0.5) });
        y -= 12;
      }
    }
    y -= 4;
    // Table header row
    page.drawRectangle({ x: margin, y: y - ROW_H + 2, width: usableW, height: ROW_H, color: rgb(0.12, 0.23, 0.37) });
    opts.headers.forEach((h, ci) => {
      const label = h.replace(/([A-Z])/g, " $1").trim();
      const truncated = label.length > 18 ? label.slice(0, 16) + ".." : label;
      page.drawText(truncated, { x: margin + ci * colW + 3, y: y - ROW_H + 5, size: 7, font: boldFont, color: rgb(1, 1, 1) });
    });
    return y - ROW_H;
  }

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = drawPageHeader(page, true);

  for (let ri = 0; ri < opts.rows.length; ri++) {
    if (ri > 0 && ri % ROWS_PER_PAGE === 0) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = drawPageHeader(page, false);
    }
    const row = opts.rows[ri];
    const isEven = ri % 2 === 0;
    if (isEven) {
      page.drawRectangle({ x: margin, y: y - ROW_H + 2, width: usableW, height: ROW_H, color: rgb(0.96, 0.97, 0.99) });
    }
    row.forEach((cell, ci) => {
      const val = cell == null ? "" : String(cell);
      const truncated = val.length > 22 ? val.slice(0, 20) + ".." : val;
      page.drawText(truncated, { x: margin + ci * colW + 3, y: y - ROW_H + 5, size: 7, font: regularFont, color: rgb(0.15, 0.15, 0.15) });
    });
    y -= ROW_H;
  }

  // Footer on last page
  const lastPage = pdfDoc.getPages().at(-1);
  if (lastPage) {
    const fy = margin + 10;
    lastPage.drawLine({ start: { x: margin, y: fy }, end: { x: PAGE_W - margin, y: fy }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    lastPage.drawText(`Generated on ${new Date().toLocaleDateString("en-IN")} · ${opts.rows.length} record(s)`, {
      x: margin, y: margin, size: 7, font: regularFont, color: rgb(0.6, 0.6, 0.6),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
