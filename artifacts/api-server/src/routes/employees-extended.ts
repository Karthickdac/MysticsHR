import { Router } from "express";
import { requireHrmsUser, requireRole } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { db } from "../lib/db";
import { checkPayrollLock } from "../lib/payroll-lock";
import {
  employeeProfilesTable,
  employeeEducationTable,
  employeeWorkExperienceTable,
  employeeDocumentsTable,
  employeeSkillsTable,
  employeeCertificationsTable,
  employeeFamilyMembersTable,
  employeeHistoryTable,
  employeesTable,
  departmentsTable,
  designationsTable,
} from "@workspace/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { recordHistory } from "../lib/history-utils";
import { autoCreateOnboardingChecklist } from "../lib/onboarding-utils";
import { seedNotificationPreferencesForEmployee } from "../lib/notification-service";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager", "hr_executive"] as const;
const HR_READ_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] as const;

const MAX_IMPORT_ROWS = 1000;
const tooManyRowsMessage = `Too many rows: limit is ${MAX_IMPORT_ROWS} per import. Split your file into smaller batches and try again.`;

router.post(
  "/employees/bulk-import",
  requireHrmsUser,
  requireRole(...HR_ROLES),
  async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows)) {
        res.status(400).json({ error: "rows must be an array" });
        return;
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        res.status(400).json({ error: tooManyRowsMessage });
        return;
      }
      let imported = 0;
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          if (!r.employeeId || !r.firstName || !r.lastName || !r.email) {
            errors.push({ row: i + 1, error: "employeeId, firstName, lastName, email are required" });
            continue;
          }
          const [insertedEmp] = await db.insert(employeesTable).values({
            employeeId: r.employeeId,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            phone: r.phone ?? null,
            dateOfBirth: r.dateOfBirth ?? null,
            gender: (r.gender as "Male" | "Female" | "Other") ?? null,
            location: r.location ?? null,
            employmentType: (r.employmentType as "Permanent" | "Contract" | "Probation" | "Intern" | "Part-Time") ?? "Permanent",
            status: (r.status as "Pre-Joining" | "Active" | "On Leave of Absence" | "Suspended" | "Notice Period" | "Separated") ?? "Pre-Joining",
            dateOfJoining: r.dateOfJoining ?? null,
          }).returning({ id: employeesTable.id });
          imported++;
          if (insertedEmp) {
            // Mirror POST /employees: seed notification preferences from the
            // company-wide defaults so bulk-imported hires get the same
            // starting toggles as singly-created ones.
            try {
              await seedNotificationPreferencesForEmployee(insertedEmp.id);
            } catch (e) {
              console.error(`Notification preference seeding for bulk row ${i + 1} failed (non-fatal):`, e);
            }
            if (r.dateOfJoining) {
              try {
                await autoCreateOnboardingChecklist(insertedEmp.id, r.dateOfJoining);
              } catch (e) {
                console.error(`Auto-checklist creation for bulk row ${i + 1} failed (non-fatal):`, e);
              }
            }
          }
        } catch (err: unknown) {
          const e = err as { code?: string; message?: string };
          const msg = e?.code === "23505" ? "Duplicate employee ID or email" : (e?.message ?? "Unknown error");
          errors.push({ row: i + 1, error: msg });
        }
      }
      await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "Employees", recordId: 0, newValue: `${imported} imported`, ipAddress: req.ip });
      res.json({ imported, skipped: errors.length, errors });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/employees/:id/profile", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [profile] = await db
      .select()
      .from(employeeProfilesTable)
      .where(eq(employeeProfilesTable.employeeId, id))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put(
  "/employees/:id/profile",
  requireHrmsUser,
  requireRole(...HR_ROLES),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const b = req.body;

      // If the request touches bank account fields, enforce payroll lock
      const hasBankUpdate = ["bankAccountName", "bankAccountNumber", "ifscCode", "bankName", "bankBranch"]
        .some(f => Object.prototype.hasOwnProperty.call(b, f));
      if (hasBankUpdate) {
        const lockError = await checkPayrollLock(req.hrmsUser!.id, "edit_bank_account");
        if (lockError) { res.status(422).json({ error: lockError }); return; }
      }

      const [existing] = await db
        .select()
        .from(employeeProfilesTable)
        .where(eq(employeeProfilesTable.employeeId, id))
        .limit(1);
      const profileData = {
        nationalId: b.nationalId ?? null,
        pan: b.pan ?? null,
        aadhaar: b.aadhaar ?? null,
        pfNumber: b.pfNumber ?? null,
        esiNumber: b.esiNumber ?? null,
        uan: b.uan ?? null,
        maritalStatus: b.maritalStatus ?? null,
        bloodGroup: b.bloodGroup ?? null,
        nationality: b.nationality ?? null,
        permanentAddress: b.permanentAddress ?? null,
        currentAddress: b.currentAddress ?? null,
        linkedinUrl: b.linkedinUrl ?? null,
        emergencyContactName: b.emergencyContactName ?? null,
        emergencyContactPhone: b.emergencyContactPhone ?? null,
        emergencyContactRelation: b.emergencyContactRelation ?? null,
        bankAccountName: b.bankAccountName ?? null,
        bankAccountNumber: b.bankAccountNumber ?? null,
        ifscCode: b.ifscCode ?? null,
        bankName: b.bankName ?? null,
        bankBranch: b.bankBranch ?? null,
        probationEndDate: b.probationEndDate ?? null,
        confirmationDate: b.confirmationDate ?? null,
        noticePeriodDays: b.noticePeriodDays ?? null,
        workLocation: b.workLocation ?? null,
        updatedAt: new Date(),
      };
      let profile;
      if (existing) {
        const changedById = req.hrmsUser?.id ?? null;
        const fields = Object.keys(profileData).filter((k) => k !== "updatedAt") as (keyof typeof profileData)[];
        for (const f of fields) {
          const oldVal = String((existing as Record<string, unknown>)[f] ?? "");
          const newVal = String((profileData as Record<string, unknown>)[f] ?? "");
          await recordHistory(id, "EmployeeProfile", f, oldVal === "null" ? null : oldVal, newVal === "null" ? null : newVal, changedById);
        }
        [profile] = await db
          .update(employeeProfilesTable)
          .set(profileData)
          .where(eq(employeeProfilesTable.employeeId, id))
          .returning();
      } else {
        [profile] = await db
          .insert(employeeProfilesTable)
          .values({ employeeId: id, ...profileData })
          .returning();
      }
      await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeProfile", recordId: id, ipAddress: req.ip });
      res.json(profile);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/employees/:id/education", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeEducationTable)
      .where(eq(employeeEducationTable.employeeId, id))
      .orderBy(desc(employeeEducationTable.endYear));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/education", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { degree, institution, fieldOfStudy, startYear, endYear, grade } = req.body;
    if (!degree || !institution) {
      res.status(400).json({ error: "degree and institution are required" });
      return;
    }
    const [row] = await db
      .insert(employeeEducationTable)
      .values({ employeeId: id, degree, institution, fieldOfStudy, startYear, endYear, grade })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "EmployeeEducation", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/education/import", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { rows } = req.body as { rows: Record<string, string>[] };
    if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
    if (rows.length > MAX_IMPORT_ROWS) { res.status(400).json({ error: tooManyRowsMessage }); return; }
    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        const degree = String(r.degree ?? "").trim();
        const institution = String(r.institution ?? "").trim();
        if (!degree || !institution) {
          errors.push({ row: i + 1, error: "degree and institution are required" });
          continue;
        }
        const startYear = r.startYear ? parseInt(String(r.startYear), 10) : null;
        const endYear = r.endYear ? parseInt(String(r.endYear), 10) : null;
        if (r.startYear && Number.isNaN(startYear)) { errors.push({ row: i + 1, error: "startYear must be a number" }); continue; }
        if (r.endYear && Number.isNaN(endYear)) { errors.push({ row: i + 1, error: "endYear must be a number" }); continue; }
        await db.insert(employeeEducationTable).values({
          employeeId: id,
          degree,
          institution,
          fieldOfStudy: r.fieldOfStudy ? String(r.fieldOfStudy) : null,
          startYear,
          endYear,
          grade: r.grade ? String(r.grade) : null,
        });
        imported++;
      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ row: i + 1, error: e?.message ?? "Unknown error" });
      }
    }
    await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "EmployeeEducation", recordId: id, newValue: `${imported} imported`, ipAddress: req.ip });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employee-education/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { degree, institution, fieldOfStudy, startYear, endYear, grade } = req.body;
    const [existing] = await db.select().from(employeeEducationTable).where(eq(employeeEducationTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db
      .update(employeeEducationTable)
      .set({ degree, institution, fieldOfStudy, startYear, endYear, grade, updatedAt: new Date() })
      .where(eq(employeeEducationTable.id, id))
      .returning();
    const changedById = req.hrmsUser?.id ?? null;
    const eduFields: Array<{ key: keyof typeof existing; val: unknown }> = [
      { key: "degree", val: degree },
      { key: "institution", val: institution },
      { key: "fieldOfStudy", val: fieldOfStudy },
      { key: "startYear", val: startYear },
      { key: "endYear", val: endYear },
      { key: "grade", val: grade },
    ];
    for (const { key, val } of eduFields) {
      const oldVal = String(existing[key] ?? "");
      const newVal = String(val ?? "");
      await recordHistory(existing.employeeId, "EmployeeEducation", key, oldVal === "null" ? null : oldVal, newVal === "null" ? null : newVal, changedById);
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeEducation", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employee-education/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(employeeEducationTable).where(eq(employeeEducationTable.id, id));
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "EmployeeEducation", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/work-experience", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeWorkExperienceTable)
      .where(eq(employeeWorkExperienceTable.employeeId, id))
      .orderBy(desc(employeeWorkExperienceTable.startDate));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/work-experience", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { company, designation, location, startDate, endDate, description, ctcDrawn } = req.body;
    if (!company || !designation) {
      res.status(400).json({ error: "company and designation are required" });
      return;
    }
    const [row] = await db
      .insert(employeeWorkExperienceTable)
      .values({ employeeId: id, company, designation, location, startDate, endDate, description, ctcDrawn })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "EmployeeWorkExp", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/work-experience/import", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { rows } = req.body as { rows: Record<string, string>[] };
    if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
    if (rows.length > MAX_IMPORT_ROWS) { res.status(400).json({ error: tooManyRowsMessage }); return; }
    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        const company = String(r.company ?? "").trim();
        const designation = String(r.designation ?? "").trim();
        if (!company || !designation) {
          errors.push({ row: i + 1, error: "company and designation are required" });
          continue;
        }
        if (r.startDate && !dateRe.test(String(r.startDate))) { errors.push({ row: i + 1, error: "startDate must be YYYY-MM-DD" }); continue; }
        if (r.endDate && !dateRe.test(String(r.endDate))) { errors.push({ row: i + 1, error: "endDate must be YYYY-MM-DD" }); continue; }
        await db.insert(employeeWorkExperienceTable).values({
          employeeId: id,
          company,
          designation,
          location: r.location ? String(r.location) : null,
          startDate: r.startDate ? String(r.startDate) : null,
          endDate: r.endDate ? String(r.endDate) : null,
          description: r.description ? String(r.description) : null,
          ctcDrawn: r.ctcDrawn ? String(r.ctcDrawn) : null,
        });
        imported++;
      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ row: i + 1, error: e?.message ?? "Unknown error" });
      }
    }
    await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "EmployeeWorkExp", recordId: id, newValue: `${imported} imported`, ipAddress: req.ip });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employee-work-experience/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { company, designation, location, startDate, endDate, description, ctcDrawn } = req.body;
    const [existing] = await db.select().from(employeeWorkExperienceTable).where(eq(employeeWorkExperienceTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db
      .update(employeeWorkExperienceTable)
      .set({ company, designation, location, startDate, endDate, description, ctcDrawn, updatedAt: new Date() })
      .where(eq(employeeWorkExperienceTable.id, id))
      .returning();
    const changedById = req.hrmsUser?.id ?? null;
    const weFields: Array<{ key: keyof typeof existing; val: unknown }> = [
      { key: "company", val: company },
      { key: "designation", val: designation },
      { key: "location", val: location },
      { key: "startDate", val: startDate },
      { key: "endDate", val: endDate },
      { key: "description", val: description },
      { key: "ctcDrawn", val: ctcDrawn },
    ];
    for (const { key, val } of weFields) {
      const oldVal = String(existing[key] ?? "");
      const newVal = String(val ?? "");
      await recordHistory(existing.employeeId, "EmployeeWorkExp", key, oldVal === "null" ? null : oldVal, newVal === "null" ? null : newVal, changedById);
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeWorkExp", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employee-work-experience/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(employeeWorkExperienceTable).where(eq(employeeWorkExperienceTable.id, id));
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "EmployeeWorkExp", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/emp-documents", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeDocumentsTable)
      .where(eq(employeeDocumentsTable.employeeId, id))
      .orderBy(desc(employeeDocumentsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/emp-documents", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { documentType, documentName, fileUrl, issueDate, expiryDate, alertDays, notes } = req.body;
    if (!documentType || !documentName) {
      res.status(400).json({ error: "documentType and documentName are required" });
      return;
    }
    const [row] = await db
      .insert(employeeDocumentsTable)
      .values({
        employeeId: id,
        documentType,
        documentName,
        fileUrl,
        issueDate,
        expiryDate,
        alertDays: alertDays ?? 30,
        notes,
        uploadedById: req.hrmsUser?.id ?? null,
      })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "EmployeeDocuments", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/emp-documents/import", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { rows } = req.body as { rows: Record<string, string>[] };
    if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
    if (rows.length > MAX_IMPORT_ROWS) { res.status(400).json({ error: tooManyRowsMessage }); return; }
    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        const documentType = String(r.documentType ?? "").trim();
        const documentName = String(r.documentName ?? "").trim();
        if (!documentType || !documentName) {
          errors.push({ row: i + 1, error: "documentType and documentName are required" });
          continue;
        }
        if (r.issueDate && !dateRe.test(String(r.issueDate))) { errors.push({ row: i + 1, error: "issueDate must be YYYY-MM-DD" }); continue; }
        if (r.expiryDate && !dateRe.test(String(r.expiryDate))) { errors.push({ row: i + 1, error: "expiryDate must be YYYY-MM-DD" }); continue; }
        const alertDays = r.alertDays ? parseInt(String(r.alertDays), 10) : 30;
        if (r.alertDays && Number.isNaN(alertDays)) { errors.push({ row: i + 1, error: "alertDays must be a number" }); continue; }
        await db.insert(employeeDocumentsTable).values({
          employeeId: id,
          documentType,
          documentName,
          fileUrl: r.fileUrl ? String(r.fileUrl) : null,
          issueDate: r.issueDate ? String(r.issueDate) : null,
          expiryDate: r.expiryDate ? String(r.expiryDate) : null,
          alertDays,
          notes: r.notes ? String(r.notes) : null,
          uploadedById: req.hrmsUser?.id ?? null,
        });
        imported++;
      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ row: i + 1, error: e?.message ?? "Unknown error" });
      }
    }
    await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "EmployeeDocuments", recordId: id, newValue: `${imported} imported`, ipAddress: req.ip });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/emp-documents/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { documentType, documentName, fileUrl, issueDate, expiryDate, alertDays, notes } = req.body;
    const [existing] = await db.select().from(employeeDocumentsTable).where(eq(employeeDocumentsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db
      .update(employeeDocumentsTable)
      .set({ documentType, documentName, fileUrl, issueDate, expiryDate, alertDays, notes, updatedAt: new Date() })
      .where(eq(employeeDocumentsTable.id, id))
      .returning();
    const changedById = req.hrmsUser?.id ?? null;
    const docFields: Array<{ key: keyof typeof existing; val: unknown }> = [
      { key: "documentType", val: documentType },
      { key: "documentName", val: documentName },
      { key: "fileUrl", val: fileUrl },
      { key: "issueDate", val: issueDate },
      { key: "expiryDate", val: expiryDate },
      { key: "alertDays", val: alertDays },
      { key: "notes", val: notes },
    ];
    for (const { key, val } of docFields) {
      const oldVal = String(existing[key] ?? "");
      const newVal = String(val ?? "");
      await recordHistory(existing.employeeId, "EmployeeDocuments", key, oldVal === "null" ? null : oldVal, newVal === "null" ? null : newVal, changedById);
    }
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeDocuments", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/emp-documents/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(employeeDocumentsTable).where(eq(employeeDocumentsTable.id, id));
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "EmployeeDocuments", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────────
// SKILLS
// ──────────────────────────────────────────────
router.get("/employees/:id/skills", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeSkillsTable)
      .where(eq(employeeSkillsTable.employeeId, id))
      .orderBy(employeeSkillsTable.name);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/skills", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, proficiency, yearsOfExperience, lastUsedYear } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [row] = await db
      .insert(employeeSkillsTable)
      .values({ employeeId: id, name, proficiency, yearsOfExperience, lastUsedYear })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "EmployeeSkills", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/skills/import", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { rows } = req.body as { rows: Record<string, string>[] };
    if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
    if (rows.length > MAX_IMPORT_ROWS) { res.status(400).json({ error: tooManyRowsMessage }); return; }
    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    const allowedProf = new Set(["Beginner", "Intermediate", "Advanced", "Expert"]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        const name = String(r.name ?? "").trim();
        if (!name) { errors.push({ row: i + 1, error: "name is required" }); continue; }
        const proficiency = r.proficiency ? String(r.proficiency).trim() : null;
        if (proficiency && !allowedProf.has(proficiency)) {
          errors.push({ row: i + 1, error: `proficiency must be one of: ${Array.from(allowedProf).join(", ")}` });
          continue;
        }
        const yearsOfExperience = r.yearsOfExperience ? parseInt(String(r.yearsOfExperience), 10) : null;
        if (r.yearsOfExperience && Number.isNaN(yearsOfExperience)) { errors.push({ row: i + 1, error: "yearsOfExperience must be a number" }); continue; }
        const lastUsedYear = r.lastUsedYear ? parseInt(String(r.lastUsedYear), 10) : null;
        if (r.lastUsedYear && Number.isNaN(lastUsedYear)) { errors.push({ row: i + 1, error: "lastUsedYear must be a number" }); continue; }
        await db.insert(employeeSkillsTable).values({
          employeeId: id,
          name,
          proficiency,
          yearsOfExperience,
          lastUsedYear,
        });
        imported++;
      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ row: i + 1, error: e?.message ?? "Unknown error" });
      }
    }
    await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "EmployeeSkills", recordId: id, newValue: `${imported} imported`, ipAddress: req.ip });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employee-skills/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, proficiency, yearsOfExperience, lastUsedYear } = req.body;
    const [existing] = await db.select().from(employeeSkillsTable).where(eq(employeeSkillsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db
      .update(employeeSkillsTable)
      .set({ name, proficiency, yearsOfExperience, lastUsedYear, updatedAt: new Date() })
      .where(eq(employeeSkillsTable.id, id))
      .returning();
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeSkills", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employee-skills/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(employeeSkillsTable).where(eq(employeeSkillsTable.id, id));
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "EmployeeSkills", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────────
// CERTIFICATIONS
// ──────────────────────────────────────────────
router.get("/employees/:id/certifications", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeCertificationsTable)
      .where(eq(employeeCertificationsTable.employeeId, id))
      .orderBy(desc(employeeCertificationsTable.issueDate));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/certifications", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, issuingOrganization, credentialId, credentialUrl, issueDate, expiryDate } = req.body;
    if (!name || !issuingOrganization) {
      res.status(400).json({ error: "name and issuingOrganization are required" });
      return;
    }
    const [row] = await db
      .insert(employeeCertificationsTable)
      .values({ employeeId: id, name, issuingOrganization, credentialId, credentialUrl, issueDate, expiryDate })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "EmployeeCertifications", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/certifications/import", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { rows } = req.body as { rows: Record<string, string>[] };
    if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
    if (rows.length > MAX_IMPORT_ROWS) { res.status(400).json({ error: tooManyRowsMessage }); return; }
    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        const name = String(r.name ?? "").trim();
        const issuingOrganization = String(r.issuingOrganization ?? "").trim();
        if (!name || !issuingOrganization) {
          errors.push({ row: i + 1, error: "name and issuingOrganization are required" });
          continue;
        }
        if (r.issueDate && !dateRe.test(String(r.issueDate))) { errors.push({ row: i + 1, error: "issueDate must be YYYY-MM-DD" }); continue; }
        if (r.expiryDate && !dateRe.test(String(r.expiryDate))) { errors.push({ row: i + 1, error: "expiryDate must be YYYY-MM-DD" }); continue; }
        await db.insert(employeeCertificationsTable).values({
          employeeId: id,
          name,
          issuingOrganization,
          credentialId: r.credentialId ? String(r.credentialId) : null,
          credentialUrl: r.credentialUrl ? String(r.credentialUrl) : null,
          issueDate: r.issueDate ? String(r.issueDate) : null,
          expiryDate: r.expiryDate ? String(r.expiryDate) : null,
        });
        imported++;
      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ row: i + 1, error: e?.message ?? "Unknown error" });
      }
    }
    await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "EmployeeCertifications", recordId: id, newValue: `${imported} imported`, ipAddress: req.ip });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employee-certifications/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, issuingOrganization, credentialId, credentialUrl, issueDate, expiryDate } = req.body;
    const [existing] = await db.select().from(employeeCertificationsTable).where(eq(employeeCertificationsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db
      .update(employeeCertificationsTable)
      .set({ name, issuingOrganization, credentialId, credentialUrl, issueDate, expiryDate, updatedAt: new Date() })
      .where(eq(employeeCertificationsTable.id, id))
      .returning();
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeCertifications", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employee-certifications/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(employeeCertificationsTable).where(eq(employeeCertificationsTable.id, id));
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "EmployeeCertifications", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────────────────────────────────────
// FAMILY MEMBERS
// ──────────────────────────────────────────────
router.get("/employees/:id/family-members", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeFamilyMembersTable)
      .where(eq(employeeFamilyMembersTable.employeeId, id))
      .orderBy(employeeFamilyMembersTable.name);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/family-members", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, relation, dateOfBirth, gender, phone, occupation, isDependent } = req.body;
    if (!name || !relation) {
      res.status(400).json({ error: "name and relation are required" });
      return;
    }
    const [row] = await db
      .insert(employeeFamilyMembersTable)
      .values({ employeeId: id, name, relation, dateOfBirth, gender, phone, occupation, isDependent: !!isDependent })
      .returning();
    await logAudit({ user: req.hrmsUser, action: "CREATE", module: "EmployeeFamily", recordId: row.id, ipAddress: req.ip });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees/:id/family-members/import", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { rows } = req.body as { rows: Record<string, string>[] };
    if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
    if (rows.length > MAX_IMPORT_ROWS) { res.status(400).json({ error: tooManyRowsMessage }); return; }
    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const truthy = new Set(["true", "yes", "y", "1"]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        const name = String(r.name ?? "").trim();
        const relation = String(r.relation ?? "").trim();
        if (!name || !relation) {
          errors.push({ row: i + 1, error: "name and relation are required" });
          continue;
        }
        if (r.dateOfBirth && !dateRe.test(String(r.dateOfBirth))) { errors.push({ row: i + 1, error: "dateOfBirth must be YYYY-MM-DD" }); continue; }
        const isDependent = r.isDependent ? truthy.has(String(r.isDependent).trim().toLowerCase()) : false;
        await db.insert(employeeFamilyMembersTable).values({
          employeeId: id,
          name,
          relation,
          dateOfBirth: r.dateOfBirth ? String(r.dateOfBirth) : null,
          gender: r.gender ? String(r.gender) : null,
          phone: r.phone ? String(r.phone) : null,
          occupation: r.occupation ? String(r.occupation) : null,
          isDependent,
        });
        imported++;
      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ row: i + 1, error: e?.message ?? "Unknown error" });
      }
    }
    await logAudit({ user: req.hrmsUser, action: "BULK_IMPORT", module: "EmployeeFamily", recordId: id, newValue: `${imported} imported`, ipAddress: req.ip });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employee-family-members/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, relation, dateOfBirth, gender, phone, occupation, isDependent } = req.body;
    const [existing] = await db.select().from(employeeFamilyMembersTable).where(eq(employeeFamilyMembersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db
      .update(employeeFamilyMembersTable)
      .set({ name, relation, dateOfBirth, gender, phone, occupation, isDependent: !!isDependent, updatedAt: new Date() })
      .where(eq(employeeFamilyMembersTable.id, id))
      .returning();
    await logAudit({ user: req.hrmsUser, action: "UPDATE", module: "EmployeeFamily", recordId: id, ipAddress: req.ip });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employee-family-members/:id", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(employeeFamilyMembersTable).where(eq(employeeFamilyMembersTable.id, id));
    await logAudit({ user: req.hrmsUser, action: "DELETE", module: "EmployeeFamily", recordId: id, ipAddress: req.ip });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id/history", requireHrmsUser, requireRole(...HR_READ_ROLES), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = await db
      .select()
      .from(employeeHistoryTable)
      .where(eq(employeeHistoryTable.employeeId, id))
      .orderBy(desc(employeeHistoryTable.changedAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
