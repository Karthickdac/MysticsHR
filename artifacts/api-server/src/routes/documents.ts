import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  documentTemplatesTable,
  issuedDocumentsTable,
  employeesTable,
  hrmsUsersTable,
  exitRequestsTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generatePdf, substituteTemplate } from "../lib/pdf";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

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
      employeeCode: employeesTable.employeeId,
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
      employeeCode: employeesTable.employeeId,
      dateOfJoining: employeesTable.dateOfJoining,
    }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

    // Auto-populate common fields from employee data
    const autoFields: Record<string, string> = {
      employeeName: `${emp.firstName} ${emp.lastName}`,
      employeeCode: emp.employeeCode ?? "",
      dateOfJoining: emp.dateOfJoining ?? "",
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

    await logAudit({ user: u, action: "generate_document", module: "documents", recordId: issued.id });

    // Notify the employee that a document has been issued to them
    const [empUser] = await db.select({ email: hrmsUsersTable.email, name: hrmsUsersTable.name })
      .from(hrmsUsersTable).where(eq(hrmsUsersTable.employeeId, employeeId)).limit(1);
    if (empUser?.email) {
      import("../lib/notification-service").then(({ dispatchNotification }) => {
        dispatchNotification({
          eventType: "document_issued", module: "documents",
          recipientEmail: empUser.email, recipientName: empUser.name,
          variables: { documentType, recipientName: empUser.name },
          entityType: "issued_document", entityId: issued.id,
        }).catch(() => {});
      }).catch(() => {});
    }

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
      // Enforce 6-month post-separation document access window for ex-employees
      const [exitReq] = await db.select({ actualLwd: exitRequestsTable.actualLwd, requestedLwd: exitRequestsTable.requestedLwd })
        .from(exitRequestsTable)
        .where(and(
          eq(exitRequestsTable.employeeId, user.employeeId),
          eq(exitRequestsTable.status, "Separated"),
        ))
        .orderBy(desc(exitRequestsTable.updatedAt))
        .limit(1);
      if (exitReq) {
        const lwd = exitReq.actualLwd ?? exitReq.requestedLwd;
        if (lwd) {
          const lwdDate = new Date(lwd);
          const sixMonthsAfterLwd = new Date(lwdDate);
          sixMonthsAfterLwd.setMonth(sixMonthsAfterLwd.getMonth() + 6);
          if (new Date() > sixMonthsAfterLwd) {
            res.status(403).json({ error: "Document access expired: ex-employee document retention period (6 months post-separation) has elapsed." });
            return;
          }
        }
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

    // Find an active Relieving Letter template
    const [template] = await db.select().from(documentTemplatesTable)
      .where(
        and(
          eq(documentTemplatesTable.documentType, "Relieving Letter"),
          eq(documentTemplatesTable.isActive, true),
        )
      ).limit(1);

    const documentType = "Relieving Letter" as const;
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

    await logAudit({ user: u, action: "fnf_approve", module: "documents", recordId: issued.id });

    res.json({
      message: `FnF approved. Relieving Letter issued for ${emp.firstName} ${emp.lastName}.`,
      issuedDocumentId: issued.id,
      employeeId,
      lastWorkingDay,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;
