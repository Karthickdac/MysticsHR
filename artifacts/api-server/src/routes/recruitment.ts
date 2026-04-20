import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  jobRequisitionsTable,
  candidatesTable,
  interviewRoundsTable,
  interviewFeedbackTable,
  offerLettersTable,
  preOnboardingRecordsTable,
  preOnboardingDocumentsTable,
  departmentsTable,
  designationsTable,
  hrmsUsersTable,
} from "@workspace/db/schema";
import { and, eq, isNull, sql, desc } from "drizzle-orm";

const router = Router();

const HR_WRITE_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const APPROVE_ROLES = ["super_admin", "hr_manager", "hod"] as const;

function genCode(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ts}${rand}`;
}

// ──────────────────────────────────────────────
// JOB REQUISITIONS
// ──────────────────────────────────────────────

const requisitionSelect = {
  id: jobRequisitionsTable.id,
  requisitionCode: jobRequisitionsTable.requisitionCode,
  title: jobRequisitionsTable.title,
  departmentId: jobRequisitionsTable.departmentId,
  departmentName: departmentsTable.name,
  designationId: jobRequisitionsTable.designationId,
  designationTitle: designationsTable.title,
  numberOfPositions: jobRequisitionsTable.numberOfPositions,
  employmentType: jobRequisitionsTable.employmentType,
  location: jobRequisitionsTable.location,
  experienceMin: jobRequisitionsTable.experienceMin,
  experienceMax: jobRequisitionsTable.experienceMax,
  budgetMin: jobRequisitionsTable.budgetMin,
  budgetMax: jobRequisitionsTable.budgetMax,
  jobDescription: jobRequisitionsTable.jobDescription,
  requiredSkills: jobRequisitionsTable.requiredSkills,
  status: jobRequisitionsTable.status,
  raisedById: jobRequisitionsTable.raisedById,
  approverId: jobRequisitionsTable.approverId,
  approvalNotes: jobRequisitionsTable.approvalNotes,
  approvedAt: jobRequisitionsTable.approvedAt,
  closedAt: jobRequisitionsTable.closedAt,
  candidateCount: sql<number>`count(${candidatesTable.id})::int`,
  createdAt: jobRequisitionsTable.createdAt,
  updatedAt: jobRequisitionsTable.updatedAt,
};

const requisitionGroupBy = [
  jobRequisitionsTable.id,
  departmentsTable.name,
  designationsTable.title,
] as const;

router.get("/requisitions", requireHrmsUser, async (req, res) => {
  try {
    const { status, departmentId } = req.query as Record<string, string>;
    const conditions = [isNull(jobRequisitionsTable.deletedAt)];
    if (status) conditions.push(sql`${jobRequisitionsTable.status} = ${status}`);
    if (departmentId) conditions.push(eq(jobRequisitionsTable.departmentId, parseInt(departmentId, 10)));

    const rows = await db
      .select(requisitionSelect)
      .from(jobRequisitionsTable)
      .leftJoin(departmentsTable, eq(jobRequisitionsTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(jobRequisitionsTable.designationId, designationsTable.id))
      .leftJoin(
        candidatesTable,
        and(eq(candidatesTable.requisitionId, jobRequisitionsTable.id), isNull(candidatesTable.deletedAt))
      )
      .where(and(...conditions))
      .groupBy(...requisitionGroupBy)
      .orderBy(desc(jobRequisitionsTable.createdAt));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/requisitions", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const body = req.body;
    if (!body.title || !body.numberOfPositions) {
      res.status(400).json({ error: "title and numberOfPositions are required" });
      return;
    }
    const [row] = await db
      .insert(jobRequisitionsTable)
      .values({
        requisitionCode: genCode("REQ"),
        title: body.title,
        departmentId: body.departmentId ?? null,
        designationId: body.designationId ?? null,
        numberOfPositions: body.numberOfPositions,
        employmentType: body.employmentType ?? "Permanent",
        location: body.location ?? null,
        experienceMin: body.experienceMin ?? null,
        experienceMax: body.experienceMax ?? null,
        budgetMin: body.budgetMin ?? null,
        budgetMax: body.budgetMax ?? null,
        jobDescription: body.jobDescription ?? null,
        requiredSkills: body.requiredSkills ?? null,
        status: "Pending Approval",
        raisedById: req.hrmsUser?.id ?? null,
      })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Requisitions", recordId: row.id, ipAddress: req.ip });
    res.status(201).json({ ...row, candidateCount: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/requisitions/:id", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .select(requisitionSelect)
      .from(jobRequisitionsTable)
      .leftJoin(departmentsTable, eq(jobRequisitionsTable.departmentId, departmentsTable.id))
      .leftJoin(designationsTable, eq(jobRequisitionsTable.designationId, designationsTable.id))
      .leftJoin(
        candidatesTable,
        and(eq(candidatesTable.requisitionId, jobRequisitionsTable.id), isNull(candidatesTable.deletedAt))
      )
      .where(and(eq(jobRequisitionsTable.id, id), isNull(jobRequisitionsTable.deletedAt)))
      .groupBy(...requisitionGroupBy)
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/requisitions/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      "title",
      "departmentId",
      "designationId",
      "numberOfPositions",
      "employmentType",
      "location",
      "experienceMin",
      "experienceMax",
      "budgetMin",
      "budgetMax",
      "jobDescription",
      "requiredSkills",
      "status",
    ]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [row] = await db
      .update(jobRequisitionsTable)
      .set(updates)
      .where(and(eq(jobRequisitionsTable.id, id), isNull(jobRequisitionsTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Requisitions", recordId: id, ipAddress: req.ip });
    res.json({ ...row, candidateCount: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/requisitions/:id", requireHrmsUser, requireRole("super_admin", "hr_manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .update(jobRequisitionsTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobRequisitionsTable.id, id), isNull(jobRequisitionsTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "Requisitions", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/requisitions/:id/approve", requireHrmsUser, requireRole(...APPROVE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .update(jobRequisitionsTable)
      .set({
        status: "Approved",
        approverId: req.hrmsUser?.id ?? null,
        approvalNotes: req.body?.notes ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(jobRequisitionsTable.id, id), isNull(jobRequisitionsTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "APPROVE", module: "Requisitions", recordId: id, ipAddress: req.ip });
    res.json({ ...row, candidateCount: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/requisitions/:id/reject", requireHrmsUser, requireRole(...APPROVE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!req.body?.notes) {
      res.status(400).json({ error: "Rejection notes are required" });
      return;
    }
    const [row] = await db
      .update(jobRequisitionsTable)
      .set({
        status: "Rejected",
        approverId: req.hrmsUser?.id ?? null,
        approvalNotes: req.body.notes,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(jobRequisitionsTable.id, id), isNull(jobRequisitionsTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "REJECT", module: "Requisitions", recordId: id, ipAddress: req.ip });
    res.json({ ...row, candidateCount: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────────
// CANDIDATES
// ──────────────────────────────────────────────

const candidateSelect = {
  id: candidatesTable.id,
  requisitionId: candidatesTable.requisitionId,
  requisitionTitle: jobRequisitionsTable.title,
  firstName: candidatesTable.firstName,
  lastName: candidatesTable.lastName,
  email: candidatesTable.email,
  phone: candidatesTable.phone,
  currentCompany: candidatesTable.currentCompany,
  currentDesignation: candidatesTable.currentDesignation,
  totalExperience: candidatesTable.totalExperience,
  currentCtc: candidatesTable.currentCtc,
  expectedCtc: candidatesTable.expectedCtc,
  noticePeriod: candidatesTable.noticePeriod,
  resumeUrl: candidatesTable.resumeUrl,
  source: candidatesTable.source,
  stage: candidatesTable.stage,
  rejectionReason: candidatesTable.rejectionReason,
  notes: candidatesTable.notes,
  createdAt: candidatesTable.createdAt,
  updatedAt: candidatesTable.updatedAt,
};

router.get("/candidates", requireHrmsUser, async (req, res) => {
  try {
    const { requisitionId, stage } = req.query as Record<string, string>;
    const conditions = [isNull(candidatesTable.deletedAt)];
    if (requisitionId) conditions.push(eq(candidatesTable.requisitionId, parseInt(requisitionId, 10)));
    if (stage) conditions.push(sql`${candidatesTable.stage} = ${stage}`);

    const rows = await db
      .select(candidateSelect)
      .from(candidatesTable)
      .leftJoin(jobRequisitionsTable, eq(candidatesTable.requisitionId, jobRequisitionsTable.id))
      .where(and(...conditions))
      .orderBy(desc(candidatesTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/candidates", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body;
    if (!b.firstName || !b.lastName || !b.email) {
      res.status(400).json({ error: "firstName, lastName, and email are required" });
      return;
    }
    const [row] = await db
      .insert(candidatesTable)
      .values({
        requisitionId: b.requisitionId ?? null,
        firstName: b.firstName,
        lastName: b.lastName,
        email: b.email,
        phone: b.phone ?? null,
        currentCompany: b.currentCompany ?? null,
        currentDesignation: b.currentDesignation ?? null,
        totalExperience: b.totalExperience ?? null,
        currentCtc: b.currentCtc ?? null,
        expectedCtc: b.expectedCtc ?? null,
        noticePeriod: b.noticePeriod ?? null,
        resumeUrl: b.resumeUrl ?? null,
        source: b.source ?? "Other",
        notes: b.notes ?? null,
      })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Candidates", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/candidates/:id", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .select(candidateSelect)
      .from(candidatesTable)
      .leftJoin(jobRequisitionsTable, eq(candidatesTable.requisitionId, jobRequisitionsTable.id))
      .where(and(eq(candidatesTable.id, id), isNull(candidatesTable.deletedAt)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/candidates/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      "firstName",
      "lastName",
      "email",
      "phone",
      "currentCompany",
      "currentDesignation",
      "totalExperience",
      "currentCtc",
      "expectedCtc",
      "noticePeriod",
      "resumeUrl",
      "source",
      "notes",
    ]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [row] = await db
      .update(candidatesTable)
      .set(updates)
      .where(and(eq(candidatesTable.id, id), isNull(candidatesTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Candidates", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/candidates/:id", requireHrmsUser, requireRole("super_admin", "hr_manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .update(candidatesTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(candidatesTable.id, id), isNull(candidatesTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "Candidates", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const VALID_STAGES = [
  "Applied",
  "Shortlisted",
  "Interview Scheduled",
  "Interview Completed",
  "Offer Issued",
  "Offer Accepted",
  "Rejected",
  "On Hold",
];

router.post("/candidates/:id/move-stage", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { stage, rejectionReason } = req.body ?? {};
    if (!stage || !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: "Invalid or missing stage" });
      return;
    }
    if (stage === "Rejected" && !rejectionReason) {
      res.status(400).json({ error: "rejectionReason is required when moving to Rejected" });
      return;
    }
    const [row] = await db
      .update(candidatesTable)
      .set({
        stage,
        rejectionReason: stage === "Rejected" ? rejectionReason : null,
        updatedAt: new Date(),
      })
      .where(and(eq(candidatesTable.id, id), isNull(candidatesTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    await logAudit({
      user: req.hrmsUser,
      action: "STAGE_CHANGE",
      module: "Candidates",
      recordId: id,
      newValue: stage,
      ipAddress: req.ip,
    });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────────
// INTERVIEWS
// ──────────────────────────────────────────────

const interviewSelect = {
  id: interviewRoundsTable.id,
  candidateId: interviewRoundsTable.candidateId,
  roundNumber: interviewRoundsTable.roundNumber,
  roundName: interviewRoundsTable.roundName,
  interviewerId: interviewRoundsTable.interviewerId,
  interviewerName: hrmsUsersTable.name,
  scheduledAt: interviewRoundsTable.scheduledAt,
  durationMinutes: interviewRoundsTable.durationMinutes,
  mode: interviewRoundsTable.mode,
  meetingLink: interviewRoundsTable.meetingLink,
  location: interviewRoundsTable.location,
  status: interviewRoundsTable.status,
  createdAt: interviewRoundsTable.createdAt,
  updatedAt: interviewRoundsTable.updatedAt,
};

router.get("/candidates/:candidateId/interviews", requireHrmsUser, async (req, res) => {
  try {
    const candidateId = parseInt(String(req.params.candidateId), 10);
    const rows = await db
      .select(interviewSelect)
      .from(interviewRoundsTable)
      .leftJoin(hrmsUsersTable, eq(interviewRoundsTable.interviewerId, hrmsUsersTable.id))
      .where(eq(interviewRoundsTable.candidateId, candidateId))
      .orderBy(interviewRoundsTable.roundNumber);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/candidates/:candidateId/interviews", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const candidateId = parseInt(String(req.params.candidateId), 10);
    const b = req.body;
    if (!b.roundName || !b.scheduledAt) {
      res.status(400).json({ error: "roundName and scheduledAt are required" });
      return;
    }

    let roundNumber: number = b.roundNumber ?? 0;
    if (!roundNumber) {
      const [maxRow] = await db
        .select({ max: sql<number>`coalesce(max(${interviewRoundsTable.roundNumber}), 0)::int` })
        .from(interviewRoundsTable)
        .where(eq(interviewRoundsTable.candidateId, candidateId));
      roundNumber = (maxRow?.max ?? 0) + 1;
    }

    const [row] = await db
      .insert(interviewRoundsTable)
      .values({
        candidateId,
        roundNumber,
        roundName: b.roundName,
        interviewerId: b.interviewerId ?? null,
        scheduledAt: new Date(b.scheduledAt),
        durationMinutes: b.durationMinutes ?? 60,
        mode: b.mode ?? "Video",
        meetingLink: b.meetingLink ?? null,
        location: b.location ?? null,
      })
      .returning();

    await db
      .update(candidatesTable)
      .set({ stage: "Interview Scheduled", updatedAt: new Date() })
      .where(and(eq(candidatesTable.id, candidateId), sql`${candidatesTable.stage} NOT IN ('Offer Issued', 'Offer Accepted', 'Rejected')`));

    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Interviews", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/interviews/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ["roundName", "interviewerId", "durationMinutes", "mode", "meetingLink", "location", "status"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.scheduledAt !== undefined) updates.scheduledAt = new Date(req.body.scheduledAt);
    const [row] = await db.update(interviewRoundsTable).set(updates).where(eq(interviewRoundsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (req.body.status === "Completed") {
      await db
        .update(candidatesTable)
        .set({ stage: "Interview Completed", updatedAt: new Date() })
        .where(and(eq(candidatesTable.id, row.candidateId), sql`${candidatesTable.stage} NOT IN ('Offer Issued', 'Offer Accepted', 'Rejected')`));
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Interviews", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/interviews/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db.delete(interviewRoundsTable).where(eq(interviewRoundsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "Interviews", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const feedbackSelect = {
  id: interviewFeedbackTable.id,
  interviewRoundId: interviewFeedbackTable.interviewRoundId,
  interviewerId: interviewFeedbackTable.interviewerId,
  interviewerName: hrmsUsersTable.name,
  technicalScore: interviewFeedbackTable.technicalScore,
  communicationScore: interviewFeedbackTable.communicationScore,
  problemSolvingScore: interviewFeedbackTable.problemSolvingScore,
  cultureFitScore: interviewFeedbackTable.cultureFitScore,
  overallScore: interviewFeedbackTable.overallScore,
  strengths: interviewFeedbackTable.strengths,
  weaknesses: interviewFeedbackTable.weaknesses,
  comments: interviewFeedbackTable.comments,
  recommendation: interviewFeedbackTable.recommendation,
  createdAt: interviewFeedbackTable.createdAt,
  updatedAt: interviewFeedbackTable.updatedAt,
};

router.get("/interviews/:id/feedback", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select(feedbackSelect)
      .from(interviewFeedbackTable)
      .leftJoin(hrmsUsersTable, eq(interviewFeedbackTable.interviewerId, hrmsUsersTable.id))
      .where(eq(interviewFeedbackTable.interviewRoundId, id))
      .orderBy(desc(interviewFeedbackTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/interviews/:id/feedback", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const b = req.body ?? {};
    const scores = [b.technicalScore, b.communicationScore, b.problemSolvingScore, b.cultureFitScore].filter(
      (s) => typeof s === "number"
    ) as number[];
    for (const s of scores) {
      if (s < 1 || s > 10) {
        res.status(400).json({ error: "Scores must be between 1 and 10" });
        return;
      }
    }
    const overallScore =
      typeof b.overallScore === "number" ? b.overallScore : scores.length ? Math.round(scores.reduce((a, c) => a + c, 0) / scores.length) : null;

    const [row] = await db
      .insert(interviewFeedbackTable)
      .values({
        interviewRoundId: id,
        interviewerId: req.hrmsUser?.id ?? null,
        technicalScore: b.technicalScore ?? null,
        communicationScore: b.communicationScore ?? null,
        problemSolvingScore: b.problemSolvingScore ?? null,
        cultureFitScore: b.cultureFitScore ?? null,
        overallScore,
        strengths: b.strengths ?? null,
        weaknesses: b.weaknesses ?? null,
        comments: b.comments ?? null,
        recommendation: b.recommendation ?? null,
      })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "InterviewFeedback", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────────
// OFFER LETTERS
// ──────────────────────────────────────────────

const offerSelect = {
  id: offerLettersTable.id,
  offerCode: offerLettersTable.offerCode,
  candidateId: offerLettersTable.candidateId,
  candidateName: sql<string>`${candidatesTable.firstName} || ' ' || ${candidatesTable.lastName}`,
  candidateEmail: candidatesTable.email,
  jobTitle: offerLettersTable.jobTitle,
  ctc: offerLettersTable.ctc,
  joiningDate: offerLettersTable.joiningDate,
  expiryDate: offerLettersTable.expiryDate,
  letterContent: offerLettersTable.letterContent,
  letterUrl: offerLettersTable.letterUrl,
  status: offerLettersTable.status,
  issuedById: offerLettersTable.issuedById,
  issuedByName: hrmsUsersTable.name,
  issuedAt: offerLettersTable.issuedAt,
  respondedAt: offerLettersTable.respondedAt,
  notes: offerLettersTable.notes,
  createdAt: offerLettersTable.createdAt,
  updatedAt: offerLettersTable.updatedAt,
};

router.get("/offers", requireHrmsUser, async (req, res) => {
  try {
    const { status, candidateId } = req.query as Record<string, string>;
    const conditions = [];
    if (status) conditions.push(sql`${offerLettersTable.status} = ${status}`);
    if (candidateId) conditions.push(eq(offerLettersTable.candidateId, parseInt(candidateId, 10)));

    const query = db
      .select(offerSelect)
      .from(offerLettersTable)
      .leftJoin(candidatesTable, eq(offerLettersTable.candidateId, candidatesTable.id))
      .leftJoin(hrmsUsersTable, eq(offerLettersTable.issuedById, hrmsUsersTable.id));

    const rows = conditions.length
      ? await query.where(and(...conditions)).orderBy(desc(offerLettersTable.createdAt))
      : await query.orderBy(desc(offerLettersTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function generateOfferLetterContent(opts: {
  candidateName: string;
  jobTitle: string;
  ctc: string;
  joiningDate: string;
  offerCode: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  return `AUTOMYSTICS TECHNOLOGIES PRIVATE LIMITED
─────────────────────────────────────────────

Date: ${today}
Offer Reference: ${opts.offerCode}

Dear ${opts.candidateName},

We are pleased to extend an offer for the position of ${opts.jobTitle} at Automystics Technologies Private Limited.

POSITION DETAILS
- Designation: ${opts.jobTitle}
- Annual CTC: ₹${opts.ctc}
- Date of Joining: ${opts.joiningDate}

This offer is contingent upon successful completion of background verification and submission of all required pre-onboarding documents.

Please confirm your acceptance by returning a signed copy of this letter on or before the offer expiry date.

We look forward to welcoming you to the team.

Sincerely,
Human Resources
Automystics Technologies Private Limited`;
}

router.post("/candidates/:candidateId/offer", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const candidateId = parseInt(String(req.params.candidateId), 10);
    const b = req.body;
    if (!b.jobTitle || !b.ctc || !b.joiningDate) {
      res.status(400).json({ error: "jobTitle, ctc, and joiningDate are required" });
      return;
    }
    const [candidate] = await db
      .select()
      .from(candidatesTable)
      .where(and(eq(candidatesTable.id, candidateId), isNull(candidatesTable.deletedAt)))
      .limit(1);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }

    const offerCode = genCode("OFR");
    const candidateName = `${candidate.firstName} ${candidate.lastName}`;
    const letterContent =
      b.letterContent ?? generateOfferLetterContent({ candidateName, jobTitle: b.jobTitle, ctc: b.ctc, joiningDate: b.joiningDate, offerCode });

    const [row] = await db
      .insert(offerLettersTable)
      .values({
        offerCode,
        candidateId,
        jobTitle: b.jobTitle,
        ctc: b.ctc,
        joiningDate: b.joiningDate,
        expiryDate: b.expiryDate ?? null,
        letterContent,
        notes: b.notes ?? null,
        status: "Draft",
        issuedById: req.hrmsUser?.id ?? null,
      })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "Offers", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/offers/:id", requireHrmsUser, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .select(offerSelect)
      .from(offerLettersTable)
      .leftJoin(candidatesTable, eq(offerLettersTable.candidateId, candidatesTable.id))
      .leftJoin(hrmsUsersTable, eq(offerLettersTable.issuedById, hrmsUsersTable.id))
      .where(eq(offerLettersTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/offers/:id", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ["jobTitle", "ctc", "joiningDate", "expiryDate", "letterContent", "letterUrl", "notes"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [row] = await db.update(offerLettersTable).set(updates).where(eq(offerLettersTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "Offers", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/offers/:id/issue", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .update(offerLettersTable)
      .set({ status: "Issued", issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(offerLettersTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    await db
      .update(candidatesTable)
      .set({ stage: "Offer Issued", updatedAt: new Date() })
      .where(eq(candidatesTable.id, row.candidateId));
    await logAudit({ user: req.hrmsUser, action: "ISSUE", module: "Offers", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const DEFAULT_DOC_CHECKLIST: Array<{ documentType: string; documentName: string; isRequired: number }> = [
  { documentType: "Government ID", documentName: "Aadhaar / Government ID", isRequired: 1 },
  { documentType: "PAN Card", documentName: "PAN Card", isRequired: 1 },
  { documentType: "Bank Account Details", documentName: "Bank Account Details (Cancelled Cheque)", isRequired: 1 },
  { documentType: "Passport Photo", documentName: "Passport-Size Photograph", isRequired: 1 },
  { documentType: "Educational Certificate", documentName: "Highest Educational Certificate", isRequired: 1 },
  { documentType: "Experience Letter", documentName: "Previous Employer Experience Letter", isRequired: 0 },
  { documentType: "Relieving Letter", documentName: "Relieving Letter from Previous Employer", isRequired: 0 },
  { documentType: "Salary Slip", documentName: "Last 3 Months Salary Slips", isRequired: 0 },
  { documentType: "Address Proof", documentName: "Address Proof", isRequired: 1 },
];

router.post("/offers/:id/accept", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [offer] = await db
      .update(offerLettersTable)
      .set({ status: "Accepted", respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(offerLettersTable.id, id))
      .returning();
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }

    await db
      .update(candidatesTable)
      .set({ stage: "Offer Accepted", updatedAt: new Date() })
      .where(eq(candidatesTable.id, offer.candidateId));

    const [existing] = await db
      .select()
      .from(preOnboardingRecordsTable)
      .where(eq(preOnboardingRecordsTable.candidateId, offer.candidateId))
      .limit(1);

    let preOnboardingRecord = existing;
    if (!preOnboardingRecord) {
      const [created] = await db
        .insert(preOnboardingRecordsTable)
        .values({
          candidateId: offer.candidateId,
          offerLetterId: offer.id,
          expectedJoiningDate: offer.joiningDate,
          status: "Pending",
          completionPercentage: 0,
        })
        .returning();
      preOnboardingRecord = created;

      await db.insert(preOnboardingDocumentsTable).values(
        DEFAULT_DOC_CHECKLIST.map((d) => ({
          recordId: created.id,
          documentType: d.documentType as "Government ID",
          documentName: d.documentName,
          isRequired: d.isRequired,
        }))
      );
    }

    await logAudit({ user: req.hrmsUser, action: "ACCEPT", module: "Offers", recordId: id, ipAddress: req.ip });
    res.json({ offer, preOnboardingRecord });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/offers/:id/reject", requireHrmsUser, requireRole(...HR_WRITE_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [row] = await db
      .update(offerLettersTable)
      .set({
        status: "Rejected",
        respondedAt: new Date(),
        notes: req.body?.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(offerLettersTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    await logAudit({ user: req.hrmsUser, action: "REJECT", module: "Offers", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
