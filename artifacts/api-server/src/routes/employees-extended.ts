import { Router } from "express";
import ExcelJS from "exceljs";
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

type RowMap = Record<string, string>;
type SectionResult = { imported: number; errors: { row: number; error: string }[] };

function createSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: { header: string; key: string; required: boolean; width: number; note?: string }[],
  exampleRow: Record<string, string | number>
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width }));
  const hRow = ws.getRow(1);
  hRow.height = 22;
  hRow.eachCell((cell, colNum) => {
    const col = cols[colNum - 1];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col?.required ? "FF1D4ED8" : "FF3B82F6" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFDBFE" } } };
    if (col?.note) {
      cell.note = { texts: [{ text: col.note }] };
    }
  });
  ws.addRow(exampleRow);
  const eRow = ws.getRow(2);
  eRow.eachCell((cell) => {
    cell.font = { color: { argb: "FF64748B" }, italic: true, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
  });
  return ws;
}

router.get(
  "/employees/bulk-import/template",
  requireHrmsUser,
  requireRole(...HR_ROLES),
  async (_req, res) => {
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "MysticsHR";
      wb.created = new Date();

      createSheet(wb, "Employees", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16, note: "Unique employee code e.g. EMP001. Required." },
        { header: "firstName *", key: "firstName", required: true, width: 16 },
        { header: "lastName *", key: "lastName", required: true, width: 16 },
        { header: "email *", key: "email", required: true, width: 28 },
        { header: "phone", key: "phone", required: false, width: 16 },
        { header: "dateOfBirth", key: "dateOfBirth", required: false, width: 20, note: "Format: YYYY-MM-DD" },
        { header: "gender", key: "gender", required: false, width: 14, note: "Male / Female / Other" },
        { header: "department", key: "department", required: false, width: 22, note: "Must match existing department name exactly" },
        { header: "designation", key: "designation", required: false, width: 22, note: "Must match existing designation title exactly" },
        { header: "employmentType", key: "employmentType", required: false, width: 18, note: "Permanent / Contract / Probation / Intern / Part-Time" },
        { header: "status", key: "status", required: false, width: 20, note: "Pre-Joining / Active / On Leave of Absence / Suspended / Notice Period / Separated" },
        { header: "dateOfJoining", key: "dateOfJoining", required: false, width: 20, note: "Format: YYYY-MM-DD" },
        { header: "ctc", key: "ctc", required: false, width: 14, note: "Annual CTC in numbers" },
        { header: "location", key: "location", required: false, width: 16 },
        { header: "timezone", key: "timezone", required: false, width: 20, note: "e.g. Asia/Kolkata (default)" },
        { header: "managerEmployeeId", key: "managerEmployeeId", required: false, width: 20, note: "Employee ID of the manager (must already exist)" },
      ], {
        employeeId: "EMP001", firstName: "Jane", lastName: "Doe", email: "jane.doe@automystics.com",
        phone: "9876543210", dateOfBirth: "1995-04-12", gender: "Female",
        department: "Engineering", designation: "Software Engineer",
        employmentType: "Permanent", status: "Active", dateOfJoining: "2024-01-15",
        ctc: "600000", location: "Chennai", timezone: "Asia/Kolkata", managerEmployeeId: "",
      });

      createSheet(wb, "Profiles", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16, note: "Must match employeeId from Employees sheet" },
        { header: "nationalId", key: "nationalId", required: false, width: 18 },
        { header: "pan", key: "pan", required: false, width: 14 },
        { header: "aadhaar", key: "aadhaar", required: false, width: 16 },
        { header: "pfNumber", key: "pfNumber", required: false, width: 16 },
        { header: "esiNumber", key: "esiNumber", required: false, width: 16 },
        { header: "uan", key: "uan", required: false, width: 14 },
        { header: "maritalStatus", key: "maritalStatus", required: false, width: 16, note: "Single / Married / Divorced / Widowed" },
        { header: "bloodGroup", key: "bloodGroup", required: false, width: 14, note: "A+ / A- / B+ / B- / AB+ / AB- / O+ / O-" },
        { header: "nationality", key: "nationality", required: false, width: 16 },
        { header: "permanentAddress", key: "permanentAddress", required: false, width: 30 },
        { header: "currentAddress", key: "currentAddress", required: false, width: 30 },
        { header: "personalEmail", key: "personalEmail", required: false, width: 28 },
        { header: "linkedinUrl", key: "linkedinUrl", required: false, width: 30 },
        { header: "emergencyContactName", key: "emergencyContactName", required: false, width: 22 },
        { header: "emergencyContactPhone", key: "emergencyContactPhone", required: false, width: 22 },
        { header: "emergencyContactRelation", key: "emergencyContactRelation", required: false, width: 24 },
        { header: "bankAccountName", key: "bankAccountName", required: false, width: 22 },
        { header: "bankAccountNumber", key: "bankAccountNumber", required: false, width: 22 },
        { header: "ifscCode", key: "ifscCode", required: false, width: 14 },
        { header: "bankName", key: "bankName", required: false, width: 20 },
        { header: "bankBranch", key: "bankBranch", required: false, width: 20 },
        { header: "probationEndDate", key: "probationEndDate", required: false, width: 20, note: "YYYY-MM-DD" },
        { header: "confirmationDate", key: "confirmationDate", required: false, width: 20, note: "YYYY-MM-DD" },
        { header: "noticePeriodDays", key: "noticePeriodDays", required: false, width: 18, note: "Number of days" },
        { header: "workLocation", key: "workLocation", required: false, width: 18 },
      ], {
        employeeId: "EMP001", nationalId: "", pan: "ABCDE1234F", aadhaar: "1234-5678-9012",
        pfNumber: "", esiNumber: "", uan: "", maritalStatus: "Single", bloodGroup: "O+",
        nationality: "Indian", permanentAddress: "123 Main St, Chennai", currentAddress: "123 Main St, Chennai",
        personalEmail: "jane.personal@gmail.com", linkedinUrl: "https://linkedin.com/in/janedoe",
        emergencyContactName: "John Doe", emergencyContactPhone: "9876543211", emergencyContactRelation: "Father",
        bankAccountName: "Jane Doe", bankAccountNumber: "123456789012", ifscCode: "HDFC0001234",
        bankName: "HDFC Bank", bankBranch: "Anna Nagar", probationEndDate: "2024-07-15",
        confirmationDate: "2024-07-15", noticePeriodDays: "90", workLocation: "Chennai HQ",
      });

      createSheet(wb, "Education", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16 },
        { header: "degree *", key: "degree", required: true, width: 20, note: "e.g. B.Tech, M.Tech, MBA, B.Com" },
        { header: "institution *", key: "institution", required: true, width: 30 },
        { header: "fieldOfStudy", key: "fieldOfStudy", required: false, width: 24 },
        { header: "startYear", key: "startYear", required: false, width: 12, note: "e.g. 2015" },
        { header: "endYear", key: "endYear", required: false, width: 12, note: "e.g. 2019" },
        { header: "grade", key: "grade", required: false, width: 14, note: "e.g. 8.5 CGPA or 85%" },
      ], {
        employeeId: "EMP001", degree: "B.Tech", institution: "Anna University",
        fieldOfStudy: "Computer Science", startYear: "2015", endYear: "2019", grade: "8.5 CGPA",
      });

      createSheet(wb, "Work_Experience", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16 },
        { header: "company *", key: "company", required: true, width: 24 },
        { header: "designation *", key: "designation", required: true, width: 24 },
        { header: "location", key: "location", required: false, width: 18 },
        { header: "startDate", key: "startDate", required: false, width: 18, note: "YYYY-MM-DD" },
        { header: "endDate", key: "endDate", required: false, width: 18, note: "YYYY-MM-DD. Leave blank if current." },
        { header: "description", key: "description", required: false, width: 36 },
        { header: "ctcDrawn", key: "ctcDrawn", required: false, width: 16 },
      ], {
        employeeId: "EMP001", company: "Tech Mahindra", designation: "Junior Developer",
        location: "Bangalore", startDate: "2019-06-01", endDate: "2023-12-31",
        description: "Enterprise Java applications", ctcDrawn: "480000",
      });

      createSheet(wb, "Skills", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16 },
        { header: "name *", key: "name", required: true, width: 22, note: "e.g. JavaScript, Python, SQL" },
        { header: "proficiency", key: "proficiency", required: false, width: 18, note: "Beginner / Intermediate / Advanced / Expert" },
        { header: "yearsOfExperience", key: "yearsOfExperience", required: false, width: 20, note: "Number e.g. 3" },
        { header: "lastUsedYear", key: "lastUsedYear", required: false, width: 16, note: "e.g. 2024" },
      ], {
        employeeId: "EMP001", name: "JavaScript", proficiency: "Advanced",
        yearsOfExperience: "4", lastUsedYear: "2024",
      });

      createSheet(wb, "Certifications", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16 },
        { header: "name *", key: "name", required: true, width: 28 },
        { header: "issuingOrganization *", key: "issuingOrganization", required: true, width: 24 },
        { header: "credentialId", key: "credentialId", required: false, width: 22 },
        { header: "credentialUrl", key: "credentialUrl", required: false, width: 34 },
        { header: "issueDate", key: "issueDate", required: false, width: 18, note: "YYYY-MM-DD" },
        { header: "expiryDate", key: "expiryDate", required: false, width: 18, note: "YYYY-MM-DD" },
      ], {
        employeeId: "EMP001", name: "AWS Certified Developer", issuingOrganization: "Amazon Web Services",
        credentialId: "ABC-12345", credentialUrl: "https://aws.amazon.com/verification",
        issueDate: "2023-03-15", expiryDate: "2026-03-15",
      });

      createSheet(wb, "Family_Members", [
        { header: "employeeId *", key: "employeeId", required: true, width: 16 },
        { header: "name *", key: "name", required: true, width: 22 },
        { header: "relation *", key: "relation", required: true, width: 16, note: "e.g. Father, Mother, Spouse, Child" },
        { header: "dateOfBirth", key: "dateOfBirth", required: false, width: 18, note: "YYYY-MM-DD" },
        { header: "gender", key: "gender", required: false, width: 12, note: "Male / Female / Other" },
        { header: "phone", key: "phone", required: false, width: 16 },
        { header: "occupation", key: "occupation", required: false, width: 20 },
        { header: "isDependent", key: "isDependent", required: false, width: 14, note: "TRUE or FALSE" },
      ], {
        employeeId: "EMP001", name: "John Doe", relation: "Father",
        dateOfBirth: "1965-06-20", gender: "Male", phone: "9876543211",
        occupation: "Retired", isDependent: "TRUE",
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="employee_import_template.xlsx"');
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to generate template" });
    }
  }
);

router.post(
  "/employees/bulk-import",
  requireHrmsUser,
  requireRole(...HR_ROLES),
  async (req, res) => {
    try {
      const body = req.body as {
        employees?: RowMap[];
        profiles?: RowMap[];
        education?: RowMap[];
        workExperience?: RowMap[];
        skills?: RowMap[];
        certifications?: RowMap[];
        familyMembers?: RowMap[];
      };

      const employees: RowMap[] = Array.isArray(body.employees) ? body.employees : [];
      const profiles: RowMap[] = Array.isArray(body.profiles) ? body.profiles : [];
      const education: RowMap[] = Array.isArray(body.education) ? body.education : [];
      const workExperience: RowMap[] = Array.isArray(body.workExperience) ? body.workExperience : [];
      const skills: RowMap[] = Array.isArray(body.skills) ? body.skills : [];
      const certifications: RowMap[] = Array.isArray(body.certifications) ? body.certifications : [];
      const familyMembers: RowMap[] = Array.isArray(body.familyMembers) ? body.familyMembers : [];

      if (employees.length === 0) {
        res.status(400).json({ error: "employees sheet must have at least one data row" });
        return;
      }
      if (employees.length > MAX_IMPORT_ROWS) {
        res.status(400).json({ error: `Too many employee rows: limit is ${MAX_IMPORT_ROWS} per import` });
        return;
      }

      const depts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable);
      const desigs = await db.select({ id: designationsTable.id, title: designationsTable.title }).from(designationsTable);
      const deptMap = new Map(depts.map(d => [d.name.toLowerCase(), d.id]));
      const desigMap = new Map(desigs.map(d => [d.title.toLowerCase(), d.id]));

      const empResult: SectionResult = { imported: 0, errors: [] };
      const empIdMap = new Map<string, number>();

      for (let i = 0; i < employees.length; i++) {
        const r = employees[i];
        if (!r.employeeId?.trim() && !r.firstName?.trim()) continue;
        try {
          if (!r.employeeId || !r.firstName || !r.lastName || !r.email) {
            empResult.errors.push({ row: i + 1, error: "employeeId, firstName, lastName, email are required" });
            continue;
          }
          const departmentId = r.department ? (deptMap.get(r.department.toLowerCase()) ?? null) : null;
          const designationId = r.designation ? (desigMap.get(r.designation.toLowerCase()) ?? null) : null;
          let managerId: number | null = null;
          if (r.managerEmployeeId?.trim()) {
            const [mgr] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.employeeId, r.managerEmployeeId.trim())).limit(1);
            managerId = mgr?.id ?? null;
          }
          const [insertedEmp] = await db.insert(employeesTable).values({
            employeeId: r.employeeId.trim(),
            firstName: r.firstName.trim(),
            lastName: r.lastName.trim(),
            email: r.email.trim(),
            phone: r.phone?.trim() || null,
            dateOfBirth: r.dateOfBirth?.trim() || null,
            gender: (r.gender?.trim() as "Male" | "Female" | "Other") || null,
            departmentId,
            designationId,
            employmentType: (r.employmentType?.trim() as any) || "Permanent",
            status: (r.status?.trim() as any) || "Pre-Joining",
            dateOfJoining: r.dateOfJoining?.trim() || null,
            ctc: r.ctc?.trim() || null,
            managerId,
            location: r.location?.trim() || null,
            timezone: r.timezone?.trim() || "Asia/Kolkata",
          }).returning({ id: employeesTable.id });
          if (insertedEmp) {
            empIdMap.set(r.employeeId.trim(), insertedEmp.id);
            empResult.imported++;
            try { await seedNotificationPreferencesForEmployee(insertedEmp.id); } catch {}
            if (r.dateOfJoining?.trim()) {
              try { await autoCreateOnboardingChecklist(insertedEmp.id, r.dateOfJoining.trim()); } catch {}
            }
          }
        } catch (err: unknown) {
          const e = err as { code?: string; message?: string };
          const msg = e?.code === "23505" ? "Duplicate employee ID or email" : (e?.message ?? "Unknown error");
          empResult.errors.push({ row: i + 1, error: msg });
        }
      }

      async function resolveDbId(empIdStr: string): Promise<number | null> {
        const trimmed = empIdStr?.trim();
        if (!trimmed) return null;
        if (empIdMap.has(trimmed)) return empIdMap.get(trimmed)!;
        const [existing] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.employeeId, trimmed)).limit(1);
        if (existing) empIdMap.set(trimmed, existing.id);
        return existing?.id ?? null;
      }

      const profileResult: SectionResult = { imported: 0, errors: [] };
      for (let i = 0; i < profiles.length; i++) {
        const r = profiles[i];
        if (!r.employeeId?.trim()) continue;
        try {
          const dbId = await resolveDbId(r.employeeId);
          if (!dbId) { profileResult.errors.push({ row: i + 1, error: `Employee '${r.employeeId}' not found` }); continue; }
          const data = {
            nationalId: r.nationalId?.trim() || null,
            pan: r.pan?.trim() || null,
            aadhaar: r.aadhaar?.trim() || null,
            pfNumber: r.pfNumber?.trim() || null,
            esiNumber: r.esiNumber?.trim() || null,
            uan: r.uan?.trim() || null,
            maritalStatus: (r.maritalStatus?.trim() as any) || null,
            bloodGroup: (r.bloodGroup?.trim() as any) || null,
            nationality: r.nationality?.trim() || null,
            permanentAddress: r.permanentAddress?.trim() || null,
            currentAddress: r.currentAddress?.trim() || null,
            personalEmail: r.personalEmail?.trim() || null,
            linkedinUrl: r.linkedinUrl?.trim() || null,
            emergencyContactName: r.emergencyContactName?.trim() || null,
            emergencyContactPhone: r.emergencyContactPhone?.trim() || null,
            emergencyContactRelation: r.emergencyContactRelation?.trim() || null,
            bankAccountName: r.bankAccountName?.trim() || null,
            bankAccountNumber: r.bankAccountNumber?.trim() || null,
            ifscCode: r.ifscCode?.trim() || null,
            bankName: r.bankName?.trim() || null,
            bankBranch: r.bankBranch?.trim() || null,
            probationEndDate: r.probationEndDate?.trim() || null,
            confirmationDate: r.confirmationDate?.trim() || null,
            noticePeriodDays: r.noticePeriodDays?.trim() ? parseInt(r.noticePeriodDays.trim(), 10) : null,
            workLocation: r.workLocation?.trim() || null,
          };
          const [existing] = await db.select({ id: employeeProfilesTable.id }).from(employeeProfilesTable).where(eq(employeeProfilesTable.employeeId, dbId)).limit(1);
          if (existing) {
            await db.update(employeeProfilesTable).set(data).where(eq(employeeProfilesTable.employeeId, dbId));
          } else {
            await db.insert(employeeProfilesTable).values({ employeeId: dbId, ...data });
          }
          profileResult.imported++;
        } catch (err: unknown) {
          profileResult.errors.push({ row: i + 1, error: (err as any)?.message ?? "Unknown error" });
        }
      }

      const eduResult: SectionResult = { imported: 0, errors: [] };
      for (let i = 0; i < education.length; i++) {
        const r = education[i];
        if (!r.employeeId?.trim()) continue;
        try {
          if (!r.degree?.trim() || !r.institution?.trim()) {
            eduResult.errors.push({ row: i + 1, error: "degree and institution are required" }); continue;
          }
          const dbId = await resolveDbId(r.employeeId);
          if (!dbId) { eduResult.errors.push({ row: i + 1, error: `Employee '${r.employeeId}' not found` }); continue; }
          await db.insert(employeeEducationTable).values({
            employeeId: dbId,
            degree: r.degree.trim(),
            institution: r.institution.trim(),
            fieldOfStudy: r.fieldOfStudy?.trim() || null,
            startYear: r.startYear?.trim() ? parseInt(r.startYear.trim(), 10) : null,
            endYear: r.endYear?.trim() ? parseInt(r.endYear.trim(), 10) : null,
            grade: r.grade?.trim() || null,
          });
          eduResult.imported++;
        } catch (err: unknown) {
          eduResult.errors.push({ row: i + 1, error: (err as any)?.message ?? "Unknown error" });
        }
      }

      const wxpResult: SectionResult = { imported: 0, errors: [] };
      for (let i = 0; i < workExperience.length; i++) {
        const r = workExperience[i];
        if (!r.employeeId?.trim()) continue;
        try {
          if (!r.company?.trim() || !r.designation?.trim()) {
            wxpResult.errors.push({ row: i + 1, error: "company and designation are required" }); continue;
          }
          const dbId = await resolveDbId(r.employeeId);
          if (!dbId) { wxpResult.errors.push({ row: i + 1, error: `Employee '${r.employeeId}' not found` }); continue; }
          await db.insert(employeeWorkExperienceTable).values({
            employeeId: dbId,
            company: r.company.trim(),
            designation: r.designation.trim(),
            location: r.location?.trim() || null,
            startDate: r.startDate?.trim() || null,
            endDate: r.endDate?.trim() || null,
            description: r.description?.trim() || null,
            ctcDrawn: r.ctcDrawn?.trim() || null,
          });
          wxpResult.imported++;
        } catch (err: unknown) {
          wxpResult.errors.push({ row: i + 1, error: (err as any)?.message ?? "Unknown error" });
        }
      }

      const skillsResult: SectionResult = { imported: 0, errors: [] };
      for (let i = 0; i < skills.length; i++) {
        const r = skills[i];
        if (!r.employeeId?.trim()) continue;
        try {
          if (!r.name?.trim()) { skillsResult.errors.push({ row: i + 1, error: "name is required" }); continue; }
          const dbId = await resolveDbId(r.employeeId);
          if (!dbId) { skillsResult.errors.push({ row: i + 1, error: `Employee '${r.employeeId}' not found` }); continue; }
          await db.insert(employeeSkillsTable).values({
            employeeId: dbId,
            name: r.name.trim(),
            proficiency: r.proficiency?.trim() || null,
            yearsOfExperience: r.yearsOfExperience?.trim() ? parseInt(r.yearsOfExperience.trim(), 10) : null,
            lastUsedYear: r.lastUsedYear?.trim() ? parseInt(r.lastUsedYear.trim(), 10) : null,
          });
          skillsResult.imported++;
        } catch (err: unknown) {
          skillsResult.errors.push({ row: i + 1, error: (err as any)?.message ?? "Unknown error" });
        }
      }

      const certResult: SectionResult = { imported: 0, errors: [] };
      for (let i = 0; i < certifications.length; i++) {
        const r = certifications[i];
        if (!r.employeeId?.trim()) continue;
        try {
          if (!r.name?.trim() || !r.issuingOrganization?.trim()) {
            certResult.errors.push({ row: i + 1, error: "name and issuingOrganization are required" }); continue;
          }
          const dbId = await resolveDbId(r.employeeId);
          if (!dbId) { certResult.errors.push({ row: i + 1, error: `Employee '${r.employeeId}' not found` }); continue; }
          await db.insert(employeeCertificationsTable).values({
            employeeId: dbId,
            name: r.name.trim(),
            issuingOrganization: r.issuingOrganization.trim(),
            credentialId: r.credentialId?.trim() || null,
            credentialUrl: r.credentialUrl?.trim() || null,
            issueDate: r.issueDate?.trim() || null,
            expiryDate: r.expiryDate?.trim() || null,
          });
          certResult.imported++;
        } catch (err: unknown) {
          certResult.errors.push({ row: i + 1, error: (err as any)?.message ?? "Unknown error" });
        }
      }

      const famResult: SectionResult = { imported: 0, errors: [] };
      for (let i = 0; i < familyMembers.length; i++) {
        const r = familyMembers[i];
        if (!r.employeeId?.trim()) continue;
        try {
          if (!r.name?.trim() || !r.relation?.trim()) {
            famResult.errors.push({ row: i + 1, error: "name and relation are required" }); continue;
          }
          const dbId = await resolveDbId(r.employeeId);
          if (!dbId) { famResult.errors.push({ row: i + 1, error: `Employee '${r.employeeId}' not found` }); continue; }
          await db.insert(employeeFamilyMembersTable).values({
            employeeId: dbId,
            name: r.name.trim(),
            relation: r.relation.trim(),
            dateOfBirth: r.dateOfBirth?.trim() || null,
            gender: r.gender?.trim() || null,
            phone: r.phone?.trim() || null,
            occupation: r.occupation?.trim() || null,
            isDependent: ["true", "yes", "1"].includes((r.isDependent ?? "").toLowerCase()),
          });
          famResult.imported++;
        } catch (err: unknown) {
          famResult.errors.push({ row: i + 1, error: (err as any)?.message ?? "Unknown error" });
        }
      }

      await logAudit({
        user: req.hrmsUser,
        action: "BULK_IMPORT",
        module: "Employees",
        recordId: 0,
        newValue: [
          `${empResult.imported} employees`,
          profileResult.imported ? `${profileResult.imported} profiles` : "",
          eduResult.imported ? `${eduResult.imported} education` : "",
          wxpResult.imported ? `${wxpResult.imported} work experience` : "",
          skillsResult.imported ? `${skillsResult.imported} skills` : "",
          certResult.imported ? `${certResult.imported} certifications` : "",
          famResult.imported ? `${famResult.imported} family members` : "",
        ].filter(Boolean).join(", ") + " imported",
        ipAddress: req.ip,
      });

      res.json({
        imported: empResult.imported,
        skipped: empResult.errors.length,
        errors: empResult.errors,
        details: {
          employees: empResult,
          profiles: profileResult,
          education: eduResult,
          workExperience: wxpResult,
          skills: skillsResult,
          certifications: certResult,
          familyMembers: famResult,
        },
      });
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
