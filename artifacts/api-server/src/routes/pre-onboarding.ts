import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  preOnboardingRecordsTable,
  preOnboardingDocumentsTable,
  candidatesTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { and, eq, sql, desc } from "drizzle-orm";

const router = Router();

const HR_WRITE_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;

const recordSelect = {
  id: preOnboardingRecordsTable.id,
  candidateId: preOnboardingRecordsTable.candidateId,
  candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
  candidateEmail: candidatesTable.email,
  offerLetterId: preOnboardingRecordsTable.offerLetterId,
  expectedJoiningDate: preOnboardingRecordsTable.expectedJoiningDate,
  status: preOnboardingRecordsTable.status,
  completionPercentage: preOnboardingRecordsTable.completionPercentage,
  notes: preOnboardingRecordsTable.notes,
  createdAt: preOnboardingRecordsTable.createdAt,
  updatedAt: preOnboardingRecordsTable.updatedAt,
};

async function recomputeCompletion(recordId: number): Promise<number> {
  const docs = await db
    .select()
    .from(preOnboardingDocumentsTable)
    .where(eq(preOnboardingDocumentsTable.recordId, recordId));
  const required = docs.filter((d) => d.isRequired === 1);
  const total = required.length || 1;
  const verified = required.filter((d) => d.status === "Verified").length;
  const pct = Math.round((verified / total) * 100);
  const newStatus = pct === 100 ? "Completed" : pct === 0 ? "Pending" : "In Progress";
  await db
    .update(preOnboardingRecordsTable)
    .set({ completionPercentage: pct, status: newStatus, updatedAt: new Date() })
    .where(eq(preOnboardingRecordsTable.id, recordId));
  return pct;
}

router.get("/pre-onboarding", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>;
    const query = db
      .select(recordSelect)
      .from(preOnboardingRecordsTable)
      .leftJoin(candidatesTable, eq(preOnboardingRecordsTable.candidateId, candidatesTable.id));
    const rows = status
      ? await query.where(sql`${preOnboardingRecordsTable.status} = ${status}`).orderBy(desc(preOnboardingRecordsTable.createdAt))
      : await query.orderBy(desc(preOnboardingRecordsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pre-onboarding/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .select(recordSelect)
      .from(preOnboardingRecordsTable)
      .leftJoin(candidatesTable, eq(preOnboardingRecordsTable.candidateId, candidatesTable.id))
      .where(eq(preOnboardingRecordsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Pre-onboarding record not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/pre-onboarding/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ["expectedJoiningDate", "status", "notes"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [row] = await db
      .update(preOnboardingRecordsTable)
      .set(updates)
      .where(eq(preOnboardingRecordsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Pre-onboarding record not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "PreOnboarding", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const docSelect = {
  id: preOnboardingDocumentsTable.id,
  recordId: preOnboardingDocumentsTable.recordId,
  documentType: preOnboardingDocumentsTable.documentType,
  documentName: preOnboardingDocumentsTable.documentName,
  fileUrl: preOnboardingDocumentsTable.fileUrl,
  status: preOnboardingDocumentsTable.status,
  uploadedAt: preOnboardingDocumentsTable.uploadedAt,
  verifiedById: preOnboardingDocumentsTable.verifiedById,
  verifiedByName: hrmsUsersTable.name,
  verifiedAt: preOnboardingDocumentsTable.verifiedAt,
  rejectionReason: preOnboardingDocumentsTable.rejectionReason,
  isRequired: preOnboardingDocumentsTable.isRequired,
  createdAt: preOnboardingDocumentsTable.createdAt,
  updatedAt: preOnboardingDocumentsTable.updatedAt,
};

router.get("/pre-onboarding/:id/documents", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select(docSelect)
      .from(preOnboardingDocumentsTable)
      .leftJoin(hrmsUsersTable, eq(preOnboardingDocumentsTable.verifiedById, hrmsUsersTable.id))
      .where(eq(preOnboardingDocumentsTable.recordId, id))
      .orderBy(preOnboardingDocumentsTable.id);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pre-onboarding/:id/documents", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const b = req.body;
    if (!b.documentType || !b.documentName) {
      res.status(400).json({ error: "documentType and documentName are required" });
      return;
    }
    const [row] = await db
      .insert(preOnboardingDocumentsTable)
      .values({
        recordId: id,
        documentType: b.documentType,
        documentName: b.documentName,
        fileUrl: b.fileUrl ?? null,
        status: b.fileUrl ? "Under Verification" : "Pending",
        uploadedAt: b.fileUrl ? new Date() : null,
        isRequired: b.isRequired ?? 1,
      })
      .returning();
    await recomputeCompletion(id);
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "PreOnboardingDocs", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/pre-onboarding-documents/:docId", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const docId = parseInt(String(req.params.docId), 10);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.documentName !== undefined) updates.documentName = req.body.documentName;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.fileUrl !== undefined) {
      updates.fileUrl = req.body.fileUrl;
      if (req.body.fileUrl) {
        updates.uploadedAt = new Date();
        if (req.body.status === undefined) updates.status = "Under Verification";
      }
    }
    const [row] = await db
      .update(preOnboardingDocumentsTable)
      .set(updates)
      .where(eq(preOnboardingDocumentsTable.id, docId))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await recomputeCompletion(row.recordId);
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "PreOnboardingDocs", recordId: docId, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pre-onboarding-documents/:docId/verify", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const docId = parseInt(String(req.params.docId), 10);
    const [row] = await db
      .update(preOnboardingDocumentsTable)
      .set({
        status: "Verified",
        verifiedById: req.hrmsUser?.id ?? null,
        verifiedAt: new Date(),
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(preOnboardingDocumentsTable.id, docId))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await recomputeCompletion(row.recordId);
    await logAudit({ user: req.hrmsUser, action: "VERIFY", module: "PreOnboardingDocs", recordId: docId, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pre-onboarding-documents/:docId/reject", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const docId = parseInt(String(req.params.docId), 10);
    if (!req.body?.reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const [row] = await db
      .update(preOnboardingDocumentsTable)
      .set({
        status: "Rejected",
        verifiedById: req.hrmsUser?.id ?? null,
        verifiedAt: new Date(),
        rejectionReason: req.body.reason,
        updatedAt: new Date(),
      })
      .where(eq(preOnboardingDocumentsTable.id, docId))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await recomputeCompletion(row.recordId);
    await logAudit({ user: req.hrmsUser, action: "REJECT", module: "PreOnboardingDocs", recordId: docId, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
