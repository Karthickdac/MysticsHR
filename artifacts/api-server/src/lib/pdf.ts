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
