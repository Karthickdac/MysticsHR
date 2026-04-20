import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  documentTemplatesTable,
  issuedDocumentsTable,
  employeesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

// ─── TEMPLATE SUBSTITUTION ───────────────────────────────────────────────────

function substituteTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key] ?? `[${key}]`);
}

// ─── PDF GENERATION ───────────────────────────────────────────────────────────

async function generatePdf(opts: {
  companyName: string;
  companyAddress: string;
  headerText: string;
  footerText: string;
  bodyText: string;
  title: string;
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  const margin = 50;
  const lineHeight = 16;

  let y = height - margin;

  // Header: Company name
  page.drawText(opts.companyName || "Automystics Technologies", {
    x: margin,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.4),
  });
  y -= lineHeight * 1.5;

  page.drawText(opts.companyAddress || "", {
    x: margin,
    y,
    size: 9,
    font: regularFont,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= lineHeight;

  if (opts.headerText) {
    page.drawText(opts.headerText, {
      x: margin,
      y,
      size: 9,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= lineHeight;
  }

  // Separator line
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= lineHeight * 1.5;

  // Document title
  page.drawText(opts.title, {
    x: margin,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.3),
  });
  y -= lineHeight * 2;

  // Body text — split into lines, wrap long lines
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
      y -= lineHeight * 0.3; // blank line
    }
  }

  // Footer
  y = margin + 40;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= lineHeight;
  if (opts.footerText) {
    page.drawText(opts.footerText, {
      x: margin,
      y,
      size: 8,
      font: regularFont,
      color: rgb(0.5, 0.5, 0.5),
    });
  }
  page.drawText(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, {
    x: width - margin - 150,
    y,
    size: 8,
    font: regularFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ─── LIST TEMPLATES ───────────────────────────────────────────────────────────
router.get("/documents/templates", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const templates = await db.select().from(documentTemplatesTable)
      .orderBy(desc(documentTemplatesTable.createdAt));
    res.json(templates);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CREATE TEMPLATE ──────────────────────────────────────────────────────────
router.post("/documents/templates", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { documentType, name, companyName, companyAddress, headerText, footerText, bodyTemplate, isActive } = req.body;
    if (!documentType || !name || !bodyTemplate) {
      res.status(400).json({ error: "documentType, name, and bodyTemplate are required" }); return;
    }

    const [tmpl] = await db.insert(documentTemplatesTable).values({
      documentType,
      name,
      companyName: companyName ?? null,
      companyAddress: companyAddress ?? null,
      headerText: headerText ?? null,
      footerText: footerText ?? null,
      bodyTemplate,
      isActive: isActive ?? true,
    }).returning();

    res.status(201).json(tmpl);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── UPDATE TEMPLATE ──────────────────────────────────────────────────────────
router.put("/documents/templates/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { documentType, name, companyName, companyAddress, headerText, footerText, bodyTemplate, isActive } = req.body;

    const [updated] = await db.update(documentTemplatesTable).set({
      documentType,
      name,
      companyName: companyName ?? null,
      companyAddress: companyAddress ?? null,
      headerText: headerText ?? null,
      footerText: footerText ?? null,
      bodyTemplate,
      isActive: isActive ?? true,
      updatedAt: new Date(),
    }).where(eq(documentTemplatesTable.id, id)).returning();

    if (!updated) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── LIST ISSUED DOCUMENTS ────────────────────────────────────────────────────
router.get("/documents/issued", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const { employeeId, documentType } = req.query as Record<string, string>;
    const u = req.hrmsUser!;
    const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);

    const conds = [];
    if (documentType) conds.push(eq(issuedDocumentsTable.documentType, documentType as "Experience Certificate"));
    if (employeeId) conds.push(eq(issuedDocumentsTable.employeeId, Number(employeeId)));

    if (!isHrRole) {
      // non-HR roles can only see their own docs
      const [user] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable)
        .where(eq(hrmsUsersTable.id, u.id));
      if (!user?.employeeId) { res.json([]); return; }
      conds.push(eq(issuedDocumentsTable.employeeId, user.employeeId));
    }

    const rows = await db.select({
      id: issuedDocumentsTable.id,
      employeeId: issuedDocumentsTable.employeeId,
      templateId: issuedDocumentsTable.templateId,
      documentType: issuedDocumentsTable.documentType,
      filename: issuedDocumentsTable.filename,
      generatedBy: issuedDocumentsTable.generatedBy,
      generatedAt: issuedDocumentsTable.generatedAt,
      fieldValues: issuedDocumentsTable.fieldValues,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeCode,
      generatedByName: hrmsUsersTable.name,
    }).from(issuedDocumentsTable)
      .leftJoin(employeesTable, eq(issuedDocumentsTable.employeeId, employeesTable.id))
      .leftJoin(hrmsUsersTable, eq(issuedDocumentsTable.generatedBy, hrmsUsersTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(issuedDocumentsTable.generatedAt));

    const result = rows.map(r => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
      employeeCode: r.employeeCode,
      templateId: r.templateId,
      documentType: r.documentType,
      filename: r.filename,
      generatedBy: r.generatedBy,
      generatedByName: r.generatedByName,
      generatedAt: r.generatedAt,
      fieldValues: r.fieldValues,
    }));

    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GENERATE DOCUMENT ────────────────────────────────────────────────────────
router.post("/documents/generate", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const { employeeId, documentType, templateId, fieldValues = {} } = req.body;
    if (!employeeId || !documentType || !templateId) {
      res.status(400).json({ error: "employeeId, documentType, and templateId are required" }); return;
    }

    const [template] = await db.select().from(documentTemplatesTable)
      .where(eq(documentTemplatesTable.id, templateId));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const [emp] = await db.select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeCode,
      dateOfJoining: employeesTable.dateOfJoining,
      lastWorkingDay: employeesTable.lastWorkingDay,
    }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

    // Auto-populate common fields from employee data
    const autoFields: Record<string, string> = {
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode ?? "",
      dateOfJoining: emp.dateOfJoining ?? "",
      lastWorkingDay: emp.lastWorkingDay ?? "",
      currentDate: new Date().toLocaleDateString("en-IN"),
      ...fieldValues,
    };

    const bodyText = substituteTemplate(template.bodyTemplate, autoFields);
    const pdfBuffer = await generatePdf({
      companyName: template.companyName ?? "Automystics Technologies",
      companyAddress: template.companyAddress ?? "",
      headerText: template.headerText ?? "",
      footerText: template.footerText ?? "",
      bodyText,
      title: documentType,
    });

    const filename = `${documentType.replace(/\s+/g, "_")}_${emp.employeeCode ?? emp.id}_${Date.now()}.pdf`;
    const fileContent = pdfBuffer.toString("base64");

    const [issued] = await db.insert(issuedDocumentsTable).values({
      employeeId,
      templateId,
      documentType,
      filename,
      generatedBy: u.id,
      fieldValues: autoFields,
      fileContent,
    }).returning();

    await logAudit({
      userId: u.id,
      action: "generate_document",
      entityType: "issued_document",
      entityId: issued.id,
      changes: { documentType, employeeId },
    });

    res.status(201).json({
      id: issued.id,
      employeeId: issued.employeeId,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode,
      templateId: issued.templateId,
      documentType: issued.documentType,
      filename: issued.filename,
      generatedBy: issued.generatedBy,
      generatedAt: issued.generatedAt,
      fieldValues: issued.fieldValues,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── DOWNLOAD DOCUMENT ────────────────────────────────────────────────────────
router.get("/documents/issued/:id/download", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const u = req.hrmsUser!;
    const isHrRole = (HR_ROLES as readonly string[]).includes(u.role);

    const [doc] = await db.select().from(issuedDocumentsTable).where(eq(issuedDocumentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Non-HR users can only download their own documents
    if (!isHrRole) {
      const [user] = await db.select({ employeeId: hrmsUsersTable.employeeId }).from(hrmsUsersTable)
        .where(eq(hrmsUsersTable.id, u.id));
      if (!user?.employeeId || user.employeeId !== doc.employeeId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    if (!doc.fileContent) { res.status(404).json({ error: "Document file not found" }); return; }

    const pdfBuffer = Buffer.from(doc.fileContent, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length.toString());
    res.send(pdfBuffer);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── FNF APPROVAL: AUTO-ISSUE RELIEVING LETTER ────────────────────────────────
router.post("/employees/:id/fnf-approve", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const employeeId = Number(req.params.id);
    const { lastWorkingDay, remarks } = req.body;
    if (!lastWorkingDay) {
      res.status(400).json({ error: "lastWorkingDay is required" }); return;
    }

    const [emp] = await db.select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeCode: employeesTable.employeeId,
      dateOfJoining: employeesTable.dateOfJoining,
    }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

    // Find an active relieving_letter template; fall back to any available template
    const [template] = await db.select().from(documentTemplatesTable)
      .where(
        and(
          eq(documentTemplatesTable.documentType, "relieving_letter"),
          eq(documentTemplatesTable.isActive, true),
        )
      ).limit(1);

    const documentType = "relieving_letter";
    const autoFields: Record<string, string> = {
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode ?? "",
      dateOfJoining: emp.dateOfJoining ?? "",
      lastWorkingDay,
      currentDate: new Date().toLocaleDateString("en-IN"),
      ...(remarks ? { remarks } : {}),
    };

    const bodyTemplate = template?.bodyTemplate ?? `This is to certify that {{employeeName}} (Employee Code: {{employeeCode}}) was employed with Automystics Technologies from {{dateOfJoining}} to {{lastWorkingDay}}. We wish {{employeeName}} all the best in their future endeavors.`;
    const bodyText = substituteTemplate(bodyTemplate, autoFields);

    const pdfBuffer = await generatePdf({
      companyName: template?.companyName ?? "Automystics Technologies",
      companyAddress: template?.companyAddress ?? "",
      headerText: template?.headerText ?? "Relieving Letter",
      footerText: template?.footerText ?? "This is a system-generated document.",
      bodyText,
      title: "Relieving Letter",
    });

    const filename = `Relieving_Letter_${emp.employeeCode ?? emp.id}_${Date.now()}.pdf`;
    const fileContent = pdfBuffer.toString("base64");

    const [issued] = await db.insert(issuedDocumentsTable).values({
      employeeId,
      templateId: template?.id ?? null,
      documentType,
      filename,
      generatedBy: u.id,
      fieldValues: autoFields,
      fileContent,
    }).returning();

    await logAudit({
      userId: u.id,
      action: "fnf_approve",
      entityType: "issued_document",
      entityId: issued.id,
      changes: { documentType, employeeId, lastWorkingDay },
    });

    res.json({
      message: `FnF approved. Relieving Letter issued for ${emp.firstName} ${emp.lastName}.`,
      issuedDocumentId: issued.id,
      employeeId,
      lastWorkingDay,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
