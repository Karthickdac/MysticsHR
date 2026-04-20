import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import {
  onboardingChecklistsTable,
  onboardingTasksTable,
  inductionSessionsTable,
  employeesTable,
  departmentsTable,
  designationsTable,
  hrmsUsersTable,
  preOnboardingRecordsTable,
  candidatesTable,
} from "@workspace/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import QRCode from "qrcode";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;

const DEFAULT_TASKS = [
  { title: "Collect and verify original documents", category: "HR" as const, assigneeRole: "hr_executive" },
  { title: "Issue employee ID card", category: "HR" as const, assigneeRole: "hr_manager" },
  { title: "Complete payroll enrollment", category: "HR" as const, assigneeRole: "hr_executive" },
  { title: "Set up company email account", category: "IT" as const, assigneeRole: "hr_executive" },
  { title: "Provision laptop and access credentials", category: "IT" as const, assigneeRole: "hr_executive" },
  { title: "Set up workstation and software tools", category: "IT" as const, assigneeRole: "hr_executive" },
  { title: "Introduce to the team and workspace", category: "Department" as const, assigneeRole: "hod" },
  { title: "Handover project briefings and SOPs", category: "Department" as const, assigneeRole: "hod" },
  { title: "Complete HR onboarding paperwork", category: "Employee" as const, assigneeRole: "employee" },
  { title: "Attend company induction session", category: "Employee" as const, assigneeRole: "employee" },
];

async function recomputeChecklist(checklistId: number) {
  const tasks = await db
    .select()
    .from(onboardingTasksTable)
    .where(eq(onboardingTasksTable.checklistId, checklistId));
  const total = tasks.length || 1;
  const completed = tasks.filter((t) => t.completedAt !== null).length;
  const pct = Math.round((completed / total) * 100);
  const status = pct === 100 ? "Completed" : pct === 0 ? "Not Started" : "In Progress";
  const updates: Record<string, unknown> = { completionPercentage: pct, status, updatedAt: new Date() };
  if (pct === 100) updates.idCardGeneratedAt = null;
  await db
    .update(onboardingChecklistsTable)
    .set(updates)
    .where(eq(onboardingChecklistsTable.id, checklistId));
  return { pct, status };
}

const checklistSelect = {
  id: onboardingChecklistsTable.id,
  employeeId: onboardingChecklistsTable.employeeId,
  employeeName: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
  employeeCode: employeesTable.employeeId,
  departmentName: departmentsTable.name,
  status: onboardingChecklistsTable.status,
  completionPercentage: onboardingChecklistsTable.completionPercentage,
  joiningDate: onboardingChecklistsTable.joiningDate,
  welcomeEmailSentAt: onboardingChecklistsTable.welcomeEmailSentAt,
  idCardGeneratedAt: onboardingChecklistsTable.idCardGeneratedAt,
  notes: onboardingChecklistsTable.notes,
  createdAt: onboardingChecklistsTable.createdAt,
  updatedAt: onboardingChecklistsTable.updatedAt,
};

router.get("/onboarding/checklists", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>;
    const query = db
      .select(checklistSelect)
      .from(onboardingChecklistsTable)
      .leftJoin(employeesTable, eq(onboardingChecklistsTable.employeeId, employeesTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id));
    const rows = status
      ? await query.where(sql`${onboardingChecklistsTable.status} = ${status}`).orderBy(desc(onboardingChecklistsTable.createdAt))
      : await query.orderBy(desc(onboardingChecklistsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/employees/:id/onboarding-checklist",
  requireHrmsUser,
  requireRole(...HR_ROLES),
  async (req, res) => {
    try {
      const employeeId = parseInt(String(req.params.id), 10);
      const existing = await db
        .select({ id: onboardingChecklistsTable.id })
        .from(onboardingChecklistsTable)
        .where(eq(onboardingChecklistsTable.employeeId, employeeId))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "Onboarding checklist already exists for this employee" });
        return;
      }
      const { joiningDate, notes } = req.body ?? {};
      const [checklist] = await db
        .insert(onboardingChecklistsTable)
        .values({ employeeId, joiningDate: joiningDate ?? null, notes: notes ?? null })
        .returning();

      const taskDueDate = joiningDate ?? null;
      for (const t of DEFAULT_TASKS) {
        await db.insert(onboardingTasksTable).values({
          checklistId: checklist.id,
          title: t.title,
          category: t.category,
          assigneeRole: t.assigneeRole,
          dueDate: taskDueDate,
        });
      }
      await logAudit({ user: req.hrmsUser, action: "CREATE", module: "OnboardingChecklist", recordId: checklist.id, ipAddress: req.ip });
      res.status(201).json(checklist);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

async function getChecklistWithTasks(checklistId: number) {
  const [checklist] = await db
    .select(checklistSelect)
    .from(onboardingChecklistsTable)
    .leftJoin(employeesTable, eq(onboardingChecklistsTable.employeeId, employeesTable.id))
    .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
    .where(eq(onboardingChecklistsTable.id, checklistId))
    .limit(1);
  if (!checklist) return null;
  const tasks = await db
    .select()
    .from(onboardingTasksTable)
    .where(eq(onboardingTasksTable.checklistId, checklistId))
    .orderBy(onboardingTasksTable.category, onboardingTasksTable.id);
  return { checklist, tasks };
}

router.get("/employees/:id/onboarding-checklist", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const employeeId = parseInt(String(req.params.id), 10);
    const [cl] = await db
      .select({ id: onboardingChecklistsTable.id })
      .from(onboardingChecklistsTable)
      .where(eq(onboardingChecklistsTable.employeeId, employeeId))
      .limit(1);
    if (!cl) {
      res.status(404).json({ error: "Onboarding checklist not found" });
      return;
    }
    const detail = await getChecklistWithTasks(cl.id);
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/onboarding/checklists/:id", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const detail = await getChecklistWithTasks(id);
    if (!detail) {
      res.status(404).json({ error: "Checklist not found" });
      return;
    }
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/onboarding/checklists/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { joiningDate, notes } = req.body;
    const [row] = await db
      .update(onboardingChecklistsTable)
      .set({ joiningDate: joiningDate ?? null, notes: notes ?? null, updatedAt: new Date() })
      .where(eq(onboardingChecklistsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Checklist not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/onboarding/checklists/:id/tasks", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const tasks = await db
      .select()
      .from(onboardingTasksTable)
      .where(eq(onboardingTasksTable.checklistId, id))
      .orderBy(onboardingTasksTable.category, onboardingTasksTable.id);
    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/onboarding/checklists/:id/tasks", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const checklistId = parseInt(String(req.params.id), 10);
    const { title, description, category, assigneeRole, dueDate, notes } = req.body;
    if (!title || !category) {
      res.status(400).json({ error: "title and category are required" });
      return;
    }
    const [task] = await db
      .insert(onboardingTasksTable)
      .values({ checklistId, title, description, category, assigneeRole, dueDate, notes })
      .returning();
    await recomputeChecklist(checklistId);
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "OnboardingTask", recordId: task.id, ipAddress: req.ip });
    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/onboarding/tasks/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { title, description, category, assigneeRole, dueDate, notes } = req.body;
    const [task] = await db
      .update(onboardingTasksTable)
      .set({ title, description, category, assigneeRole, dueDate, notes, updatedAt: new Date() })
      .where(eq(onboardingTasksTable.id, id))
      .returning();
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/onboarding/tasks/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [task] = await db.delete(onboardingTasksTable).where(eq(onboardingTasksTable.id, id)).returning();
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    await recomputeChecklist(task.checklistId);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/onboarding/tasks/:id/complete", requireHrmsUser, requireRole(...HR_ROLES, "hod", "employee"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { notes } = req.body ?? {};

    const [existingTask] = await db
      .select()
      .from(onboardingTasksTable)
      .where(eq(onboardingTasksTable.id, id))
      .limit(1);
    if (!existingTask) { res.status(404).json({ error: "Task not found" }); return; }

    if (req.hrmsUser?.role === "employee") {
      if (existingTask.assigneeRole !== "employee") {
        res.status(403).json({ error: "You can only complete tasks assigned to employees." });
        return;
      }
      const [checklist] = await db
        .select({ employeeId: onboardingChecklistsTable.employeeId })
        .from(onboardingChecklistsTable)
        .where(eq(onboardingChecklistsTable.id, existingTask.checklistId))
        .limit(1);
      const [hrmsUser] = await db
        .select({ employeeId: hrmsUsersTable.employeeId })
        .from(hrmsUsersTable)
        .where(eq(hrmsUsersTable.id, req.hrmsUser.id))
        .limit(1);
      if (!checklist || !hrmsUser?.employeeId || checklist.employeeId !== hrmsUser.employeeId) {
        res.status(403).json({ error: "You can only complete tasks in your own onboarding checklist." });
        return;
      }
    }

    const [task] = await db
      .update(onboardingTasksTable)
      .set({
        completedAt: new Date(),
        completedById: req.hrmsUser?.id ?? null,
        notes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(onboardingTasksTable.id, id))
      .returning();
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    await recomputeChecklist(task.checklistId);
    await logAudit({ user: req.hrmsUser, action: "COMPLETE", module: "OnboardingTask", recordId: id, ipAddress: req.ip });
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/onboarding/tasks/:id/uncomplete", requireHrmsUser, requireRole(...HR_ROLES, "hod"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [task] = await db
      .update(onboardingTasksTable)
      .set({ completedAt: null, completedById: null, updatedAt: new Date() })
      .where(eq(onboardingTasksTable.id, id))
      .returning();
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    await recomputeChecklist(task.checklistId);
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/induction-sessions", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const sessions = await db
      .select()
      .from(inductionSessionsTable)
      .where(eq(inductionSessionsTable.employeeId, id))
      .orderBy(desc(inductionSessionsTable.sessionDate));
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/induction-sessions", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { sessionDate, trainerName, topics, durationMinutes, notes } = req.body;
    if (!sessionDate || !trainerName) {
      res.status(400).json({ error: "sessionDate and trainerName are required" });
      return;
    }
    const [session] = await db
      .insert(inductionSessionsTable)
      .values({
        employeeId: id,
        sessionDate,
        trainerName,
        topics,
        durationMinutes,
        notes,
        recordedById: req.hrmsUser?.id ?? null,
      })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "InductionSession", recordId: session.id, ipAddress: req.ip });
    res.status(201).json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/induction-sessions/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { sessionDate, trainerName, topics, durationMinutes, notes } = req.body;
    const [session] = await db
      .update(inductionSessionsTable)
      .set({ sessionDate, trainerName, topics, durationMinutes, notes, updatedAt: new Date() })
      .where(eq(inductionSessionsTable.id, id))
      .returning();
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/induction-sessions/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(inductionSessionsTable).where(eq(inductionSessionsTable.id, id));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/id-card", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [emp] = await db
      .select({
        id: employeesTable.id,
        employeeId: employeesTable.employeeId,
        firstName: employeesTable.firstName,
        lastName: employeesTable.lastName,
        email: employeesTable.email,
        avatarUrl: employeesTable.avatarUrl,
        designationTitle: designationsTable.title,
        departmentName: departmentsTable.name,
      })
      .from(employeesTable)
      .leftJoin(designationsTable, eq(employeesTable.designationId, designationsTable.id))
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(eq(employeesTable.id, id))
      .limit(1);

    if (!emp) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const [checklist] = await db
      .select()
      .from(onboardingChecklistsTable)
      .where(eq(onboardingChecklistsTable.employeeId, id))
      .limit(1);

    if (!checklist || checklist.completionPercentage < 100) {
      res.status(403).json({
        error: "ID card cannot be generated: onboarding checklist is not 100% complete.",
        completionPercentage: checklist?.completionPercentage ?? 0,
      });
      return;
    }

    const [preOnboardingRecord] = await db
      .select({ completionPercentage: preOnboardingRecordsTable.completionPercentage })
      .from(preOnboardingRecordsTable)
      .innerJoin(candidatesTable, eq(preOnboardingRecordsTable.candidateId, candidatesTable.id))
      .where(eq(candidatesTable.email, emp.email))
      .limit(1);

    if (preOnboardingRecord && preOnboardingRecord.completionPercentage < 100) {
      res.status(403).json({
        error: "ID card cannot be generated: pre-onboarding document verification is not complete.",
        documentCompletionPercentage: preOnboardingRecord.completionPercentage,
      });
      return;
    }

    const employeeName = `${emp.firstName} ${emp.lastName}`;
    const qrData = JSON.stringify({
      id: emp.employeeId,
      name: employeeName,
      dept: emp.departmentName ?? "",
      designation: emp.designationTitle ?? "",
    });
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { width: 120, margin: 1 });
    const qrBase64 = qrCodeDataUrl.replace(/^data:image\/png;base64,/, "");
    const qrBuf = Buffer.from(qrBase64, "base64");

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([226, 340]);
    const { width, height } = page.getSize();

    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const dark = rgb(0.118, 0.176, 0.298);
    const blue = rgb(0.231, 0.510, 0.965);
    const white = rgb(1, 1, 1);
    const muted = rgb(0.580, 0.627, 0.729);
    const panel = rgb(0.200, 0.263, 0.384);

    page.drawRectangle({ x: 0, y: 0, width, height, color: dark });
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: blue });
    page.drawRectangle({ x: 0, y: 0, width, height: 8, color: blue });

    page.drawText("AUTOMYSTICS TECHNOLOGIES", { x: 0, y: height - 28, size: 9, font: boldFont, color: white, maxWidth: width, lineHeight: 14 });
    page.drawText("EMPLOYEE ID CARD", { x: 68, y: height - 40, size: 7, font: regularFont, color: muted });

    page.drawRectangle({ x: 83, y: height - 116, width: 60, height: 60, color: panel });
    page.drawText("PHOTO", { x: 101, y: height - 92, size: 7, font: regularFont, color: muted });

    const nameWidth = boldFont.widthOfTextAtSize(employeeName, 11);
    page.drawText(employeeName, { x: (width - nameWidth) / 2, y: height - 135, size: 11, font: boldFont, color: white });

    const desigText = (emp.designationTitle ?? "—").slice(0, 32);
    const desigWidth = regularFont.widthOfTextAtSize(desigText, 8);
    page.drawText(desigText, { x: (width - desigWidth) / 2, y: height - 150, size: 8, font: regularFont, color: blue });

    page.drawLine({ start: { x: 20, y: height - 160 }, end: { x: 206, y: height - 160 }, thickness: 0.5, color: panel });

    const rows2 = [
      ["Employee ID", emp.employeeId],
      ["Department", emp.departmentName ?? "—"],
      ["Email", emp.email.slice(0, 26)],
    ];
    rows2.forEach(([label, value], i) => {
      const y = height - 176 - i * 22;
      page.drawText(label + ":", { x: 25, y, size: 7, font: regularFont, color: muted });
      page.drawText(value, { x: 115, y, size: 7, font: boldFont, color: white });
    });

    page.drawLine({ start: { x: 20, y: height - 242 }, end: { x: 206, y: height - 242 }, thickness: 0.5, color: panel });

    const qrImage = await pdfDoc.embedPng(qrBuf);
    page.drawImage(qrImage, { x: 83, y: height - 308, width: 60, height: 60 });
    page.drawText("Scan to verify", { x: 80, y: height - 324, size: 6, font: regularFont, color: muted });

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    await db
      .update(onboardingChecklistsTable)
      .set({ idCardGeneratedAt: new Date(), updatedAt: new Date() })
      .where(eq(onboardingChecklistsTable.id, checklist.id));

    await logAudit({ user: req.hrmsUser, action: "GENERATE_ID_CARD", module: "Onboarding", recordId: id, ipAddress: req.ip });

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="idcard_${emp.employeeId}.pdf"`);
    res.set("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
