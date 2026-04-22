import { db } from "./lib/db";
import {
  departmentsTable,
  designationsTable,
  employeesTable,
  hrmsUsersTable,
  auditLogsTable,
  rolesTable,
  // Leave
  leaveTypesTable,
  leavePoliciesTable,
  leaveBalancesTable,
  leaveApplicationsTable,
  // Attendance
  attendanceRecordsTable,
  attendanceRegularizationsTable,
  // Shifts
  shiftTemplatesTable,
  shiftAssignmentsTable,
  // Payroll
  salaryStructuresTable,
  salaryComponentsTable,
  payrollRunsTable,
  payrollRecordsTable,
  payslipsTable,
  // Performance
  performanceCyclesTable,
  performanceGoalsTable,
  goalProgressTable,
  selfAppraisalsTable,
  managerEvaluationsTable,
  // Helpdesk
  helpdeskTicketsTable,
  ticketCommentsTable,
  // Onboarding
  onboardingChecklistsTable,
  onboardingTasksTable,
  // Documents
  documentTemplatesTable,
  issuedDocumentsTable,
  // Notifications
  notificationLogsTable,
  userNotificationsTable,
} from "@workspace/db/schema";

const todayStr = () => new Date().toISOString().slice(0, 10);
const dateOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const tsOffset = (days: number, hours = 0, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

async function seed() {
  console.log("Seeding database...");

  // ── Roles ──────────────────────────────────────────────────────────────
  await db
    .insert(rolesTable)
    .values([
      { slug: "super_admin", label: "Super Admin", description: "Full access to all HRMS modules and system configuration", level: 100 },
      { slug: "hr_manager", label: "HR Manager", description: "Access to all HR operations including employee, payroll, and reporting", level: 80 },
      { slug: "payroll_admin", label: "Payroll Admin", description: "Access to payroll processing and related reports", level: 70 },
      { slug: "hr_executive", label: "HR Executive", description: "Day-to-day HR operations including employee management and attendance", level: 60 },
      { slug: "hod", label: "Head of Department", description: "View and manage employees within own department", level: 50 },
      { slug: "employee", label: "Employee", description: "Self-service portal access: own profile, leaves, payslips", level: 10 },
    ])
    .onConflictDoNothing();
  console.log("Roles seeded.");

  // ── Departments ────────────────────────────────────────────────────────
  await db
    .insert(departmentsTable)
    .values([
      { name: "Engineering", code: "ENG", description: "Product engineering and development" },
      { name: "Human Resources", code: "HR", description: "HR operations and talent management" },
      { name: "Finance", code: "FIN", description: "Finance, accounting, and payroll" },
      { name: "Technology", code: "TECH", description: "IT infrastructure and systems" },
      { name: "Marketing", code: "MKT", description: "Marketing and brand communications" },
    ])
    .onConflictDoNothing();
  const allDepts = await db.select().from(departmentsTable);
  const engDept = allDepts.find((d) => d.code === "ENG");
  const hrDept = allDepts.find((d) => d.code === "HR");
  const financeDept = allDepts.find((d) => d.code === "FIN");
  const techDept = allDepts.find((d) => d.code === "TECH");
  const marketingDept = allDepts.find((d) => d.code === "MKT");
  console.log("Departments seeded.");

  // ── Designations ───────────────────────────────────────────────────────
  await db
    .insert(designationsTable)
    .values([
      { title: "Software Engineer", code: "SWE", departmentId: engDept?.id, level: 2 },
      { title: "Senior Software Engineer", code: "SSWE", departmentId: engDept?.id, level: 3 },
      { title: "HR Executive", code: "HRE", departmentId: hrDept?.id, level: 2 },
      { title: "HR Manager", code: "HRM", departmentId: hrDept?.id, level: 4 },
      { title: "Payroll Administrator", code: "PAYROLL", departmentId: financeDept?.id, level: 3 },
      { title: "Tech Lead", code: "TL", departmentId: techDept?.id, level: 4 },
      { title: "Marketing Executive", code: "MKE", departmentId: marketingDept?.id, level: 2 },
      { title: "Finance Analyst", code: "FA", departmentId: financeDept?.id, level: 2 },
    ])
    .onConflictDoNothing();
  const allDesignations = await db.select().from(designationsTable);
  const srSwDes = allDesignations.find((d) => d.code === "SSWE");
  const swDes = allDesignations.find((d) => d.code === "SWE");
  const hrMgrDes = allDesignations.find((d) => d.code === "HRM");
  const hrExecDes = allDesignations.find((d) => d.code === "HRE");
  const payDes = allDesignations.find((d) => d.code === "PAYROLL");
  const techLeadDes = allDesignations.find((d) => d.code === "TL");
  const mktDes = allDesignations.find((d) => d.code === "MKE");
  const finDes = allDesignations.find((d) => d.code === "FA");
  console.log("Designations seeded.");

  // ── Employees ──────────────────────────────────────────────────────────
  await db
    .insert(employeesTable)
    .values([
      { employeeId: "AMT-2024-001", firstName: "Arjun", lastName: "Sharma", email: "arjun.sharma@automystics.com", phone: "+91 98765 43210", gender: "Male", departmentId: engDept?.id, designationId: srSwDes?.id, employmentType: "Permanent", status: "Active", dateOfJoining: "2024-01-15", location: "Chennai", ctc: "1800000" },
      { employeeId: "AMT-2024-002", firstName: "Priya", lastName: "Venkataraman", email: "priya.v@automystics.com", phone: "+91 87654 32109", gender: "Female", departmentId: hrDept?.id, designationId: hrMgrDes?.id, employmentType: "Permanent", status: "Active", dateOfJoining: "2024-02-01", location: "Chennai", ctc: "1500000" },
      { employeeId: "AMT-2024-003", firstName: "Ravi", lastName: "Kumar", email: "ravi.kumar@automystics.com", phone: "+91 76543 21098", gender: "Male", departmentId: financeDept?.id, designationId: payDes?.id, employmentType: "Permanent", status: "Active", dateOfJoining: "2024-03-10", location: "Bangalore", ctc: "1200000" },
      { employeeId: "AMT-2024-004", firstName: "Meena", lastName: "Rajesh", email: "meena.r@automystics.com", phone: "+91 65432 10987", gender: "Female", departmentId: hrDept?.id, designationId: hrExecDes?.id, employmentType: "Permanent", status: "Active", dateOfJoining: "2024-04-05", location: "Chennai", ctc: "750000" },
      { employeeId: "AMT-2024-005", firstName: "Suresh", lastName: "Babu", email: "suresh.b@automystics.com", phone: "+91 54321 09876", gender: "Male", departmentId: techDept?.id, designationId: techLeadDes?.id, employmentType: "Permanent", status: "Active", dateOfJoining: "2024-05-20", location: "Hyderabad", ctc: "2200000" },
      { employeeId: "AMT-2025-006", firstName: "Kavitha", lastName: "Nair", email: "kavitha.n@automystics.com", phone: "+91 43210 98765", gender: "Female", departmentId: engDept?.id, designationId: swDes?.id, employmentType: "Probation", status: "Active", dateOfJoining: "2025-01-08", location: "Chennai", ctc: "900000" },
      { employeeId: "AMT-2025-007", firstName: "Dinesh", lastName: "Murugan", email: "dinesh.m@automystics.com", phone: "+91 32109 87654", gender: "Male", departmentId: marketingDept?.id, designationId: mktDes?.id, employmentType: "Contract", status: "Notice Period", dateOfJoining: "2025-02-15", location: "Chennai", ctc: "850000" },
      { employeeId: "AMT-2026-008", firstName: "Lakshmi", lastName: "Iyer", email: "lakshmi.i@automystics.com", phone: "+91 21098 76543", gender: "Female", departmentId: financeDept?.id, designationId: finDes?.id, employmentType: "Intern", status: "Active", dateOfJoining: "2026-04-01", location: "Chennai", ctc: "350000" },
    ])
    .onConflictDoNothing();
  const allEmps = await db.select().from(employeesTable);
  const byCode = (id: string) => allEmps.find((e) => e.employeeId === id);
  const emp1 = byCode("AMT-2024-001"); // Arjun (super_admin, Eng SSE)
  const emp2 = byCode("AMT-2024-002"); // Priya (hr_manager)
  const emp3 = byCode("AMT-2024-003"); // Ravi (payroll_admin)
  const emp4 = byCode("AMT-2024-004"); // Meena (hr_executive)
  const emp5 = byCode("AMT-2024-005"); // Suresh (HOD, Tech Lead)
  const emp6 = byCode("AMT-2025-006"); // Kavitha (employee)
  const emp7 = byCode("AMT-2025-007"); // Dinesh
  const emp8 = byCode("AMT-2026-008"); // Lakshmi
  console.log("Employees seeded.");

  // Set Suresh as manager for Kavitha & Arjun (Engineering team)
  if (emp5 && emp1 && !emp1.managerId) {
    await db.update(employeesTable).set({ managerId: emp5.id }).where(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("drizzle-orm")).eq(employeesTable.id, emp1.id) as any
    );
  }
  if (emp5 && emp6 && !emp6.managerId) {
    await db.update(employeesTable).set({ managerId: emp5.id }).where(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("drizzle-orm")).eq(employeesTable.id, emp6.id) as any
    );
  }

  // ── HRMS Users ─────────────────────────────────────────────────────────
  await db
    .insert(hrmsUsersTable)
    .values([
      { clerkUserId: "demo_super_admin_001", employeeId: emp1?.id, email: "arjun.sharma@automystics.com", name: "Arjun Sharma", role: "super_admin", isActive: true },
      { clerkUserId: "demo_hr_manager_002", employeeId: emp2?.id, email: "priya.v@automystics.com", name: "Priya Venkataraman", role: "hr_manager", isActive: true },
      { clerkUserId: "demo_payroll_admin_003", employeeId: emp3?.id, email: "ravi.kumar@automystics.com", name: "Ravi Kumar", role: "payroll_admin", isActive: true },
      { clerkUserId: "demo_hr_executive_004", employeeId: emp4?.id, email: "meena.r@automystics.com", name: "Meena Rajesh", role: "hr_executive", isActive: true },
      { clerkUserId: "demo_hod_005", employeeId: emp5?.id, email: "suresh.b@automystics.com", name: "Suresh Babu", role: "hod", isActive: true },
      { clerkUserId: "demo_employee_006", employeeId: emp6?.id, email: "kavitha.n@automystics.com", name: "Kavitha Nair", role: "employee", isActive: true },
    ])
    .onConflictDoNothing();
  const allUsers = await db.select().from(hrmsUsersTable);
  const userBy = (role: string) => allUsers.find((u) => u.role === role);
  const superUser = userBy("super_admin");
  const hrMgr = userBy("hr_manager");
  const hrExec = userBy("hr_executive");
  const hodUser = userBy("hod");
  const payAdmin = userBy("payroll_admin");
  const empUser = userBy("employee");
  console.log("HRMS users seeded (all 6 roles).");

  // ── Audit logs ─────────────────────────────────────────────────────────
  await db
    .insert(auditLogsTable)
    .values([
      { action: "CREATE", module: "Employees", recordId: String(emp1?.id), userEmail: "system@automystics.com", newValue: "AMT-2024-001" },
      { action: "CREATE", module: "Employees", recordId: String(emp2?.id), userEmail: "system@automystics.com", newValue: "AMT-2024-002" },
      { action: "STATUS_CHANGE", module: "Employees", recordId: String(emp7?.id), userEmail: "priya.v@automystics.com", previousValue: "Active", newValue: "Notice Period" },
      { action: "CREATE", module: "Departments", recordId: String(engDept?.id), userEmail: "system@automystics.com", newValue: "Engineering" },
      { action: "CREATE", module: "Employees", recordId: String(emp8?.id), userEmail: "priya.v@automystics.com", newValue: "AMT-2026-008" },
    ])
    .onConflictDoNothing();
  console.log("Audit logs seeded.");

  // ═══════════════════════════════════════════════════════════════════════
  // OPERATIONAL DEMO DATA
  // ═══════════════════════════════════════════════════════════════════════
  const activeEmps = [emp1, emp2, emp3, emp4, emp5, emp6, emp8].filter(Boolean) as NonNullable<typeof emp1>[];
  const yr = new Date().getFullYear();

  // ── Shifts ─────────────────────────────────────────────────────────────
  await db.insert(shiftTemplatesTable).values([
    { name: "General Shift (9-6)", shiftType: "Fixed", startTime: "09:00", endTime: "18:00", gracePeriodMinutes: 15, breakDurationMinutes: 60, minWorkingHoursMinutes: 480, weeklyOff: ["Saturday", "Sunday"], overtimeThresholdMinutes: 30 },
    { name: "Early Shift (7-4)", shiftType: "Fixed", startTime: "07:00", endTime: "16:00", gracePeriodMinutes: 10, breakDurationMinutes: 45, weeklyOff: ["Sunday"] },
    { name: "Night Shift (10-7)", shiftType: "Night Shift", startTime: "22:00", endTime: "07:00", breakDurationMinutes: 60, weeklyOff: ["Sunday"], shiftRatePerHour: "75.00", nightDifferentialRate: "150.00" },
    { name: "Flexible WFH", shiftType: "Flexible", startTime: "10:00", endTime: "19:00", gracePeriodMinutes: 60, breakDurationMinutes: 60, weeklyOff: ["Saturday", "Sunday"] },
  ]).onConflictDoNothing();
  const allShifts = await db.select().from(shiftTemplatesTable);
  const generalShift = allShifts.find((s) => s.name === "General Shift (9-6)");

  if (generalShift) {
    const existingAssign = await db.select().from(shiftAssignmentsTable);
    if (existingAssign.length === 0) {
      await db.insert(shiftAssignmentsTable).values(
        activeEmps.map((e) => ({
          employeeId: e.id, shiftTemplateId: generalShift.id,
          effectiveFrom: e.dateOfJoining ?? "2024-01-01", assignedById: hrMgr?.id,
        }))
      );
    }
  }
  console.log("Shifts seeded.");

  // ── Leave types & policies ─────────────────────────────────────────────
  await db.insert(leaveTypesTable).values([
    { name: "Casual Leave", code: "CL", annualQuota: "12", carryForwardEnabled: false, advanceNoticeDays: 1, allowHalfDay: true, description: "For personal matters and short breaks" },
    { name: "Sick Leave", code: "SL", annualQuota: "10", carryForwardEnabled: true, carryForwardMax: "5", advanceNoticeDays: 0, allowHalfDay: true, description: "For illness with medical certificate if > 2 days" },
    { name: "Earned Leave", code: "EL", annualQuota: "18", carryForwardEnabled: true, carryForwardMax: "30", encashmentEnabled: true, advanceNoticeDays: 7, description: "Paid time off; encashable on exit" },
    { name: "Maternity Leave", code: "ML", annualQuota: "180", carryForwardEnabled: false, advanceNoticeDays: 30, allowHalfDay: false, description: "26 weeks paid maternity leave" },
    { name: "Paternity Leave", code: "PL", annualQuota: "5", carryForwardEnabled: false, advanceNoticeDays: 7, allowHalfDay: false, description: "5 working days for new fathers" },
    { name: "Loss of Pay", code: "LOP", annualQuota: "0", carryForwardEnabled: false, lopByDefault: true, advanceNoticeDays: 0, description: "Unpaid leave when no balance available" },
  ]).onConflictDoNothing();
  const allLeaveTypes = await db.select().from(leaveTypesTable);
  const cl = allLeaveTypes.find((l) => l.code === "CL");
  const sl = allLeaveTypes.find((l) => l.code === "SL");
  const el = allLeaveTypes.find((l) => l.code === "EL");

  // Leave policies (1:1 with types)
  for (const lt of allLeaveTypes) {
    await db.insert(leavePoliciesTable).values({
      leaveTypeId: lt.id,
      requiresHodApproval: lt.code !== "LOP",
      requiresHrApproval: lt.requiresHrApproval,
      advanceNoticeDays: lt.advanceNoticeDays,
      allowHalfDay: lt.allowHalfDay,
      lopByDefault: lt.lopByDefault,
      carryForwardEnabled: lt.carryForwardEnabled,
      carryForwardMax: lt.carryForwardMax,
      encashmentEnabled: lt.encashmentEnabled,
    }).onConflictDoNothing();
  }

  // Leave balances for current year
  const balanceRows: Array<{ employeeId: number; leaveTypeId: number; year: number; allocated: string; used: string; pending: string }> = [];
  for (const e of activeEmps) {
    for (const lt of allLeaveTypes) {
      if (lt.code === "ML" && e.gender !== "Female") continue;
      if (lt.code === "PL" && e.gender !== "Male") continue;
      if (lt.code === "LOP") continue;
      balanceRows.push({
        employeeId: e.id,
        leaveTypeId: lt.id,
        year: yr,
        allocated: String(lt.annualQuota),
        used: lt.code === "CL" ? "3" : lt.code === "SL" ? "2" : lt.code === "EL" ? "5" : "0",
        pending: "0",
      });
    }
  }
  if (balanceRows.length) {
    const existingBal = await db.select().from(leaveBalancesTable);
    if (existingBal.length === 0) await db.insert(leaveBalancesTable).values(balanceRows);
  }

  // Leave applications - mix of statuses
  const existingApps = await db.select().from(leaveApplicationsTable);
  if (existingApps.length === 0 && cl && sl && el && emp6 && emp1 && emp4 && emp8) {
    await db.insert(leaveApplicationsTable).values([
      {
        employeeId: emp6.id, leaveTypeId: cl.id, fromDate: dateOffset(5), toDate: dateOffset(6),
        totalDays: "2", reason: "Personal work — sister's wedding", status: "Pending",
      },
      {
        employeeId: emp1.id, leaveTypeId: el.id, fromDate: dateOffset(15), toDate: dateOffset(19),
        totalDays: "5", reason: "Family vacation — Munnar trip", status: "Approved",
        hodActionedById: hodUser?.id, hodRemarks: "Approved. Coverage planned.", hodActionedAt: tsOffset(-2),
        hrActionedById: hrMgr?.id, hrRemarks: "All clear.", hrActionedAt: tsOffset(-1),
      },
      {
        employeeId: emp8.id, leaveTypeId: sl.id, fromDate: dateOffset(-3), toDate: dateOffset(-3),
        totalDays: "1", reason: "Fever and headache", status: "Approved",
        hrActionedById: hrExec?.id, hrRemarks: "Get well soon.", hrActionedAt: tsOffset(-3),
      },
      {
        employeeId: emp4.id, leaveTypeId: cl.id, fromDate: dateOffset(-10), toDate: dateOffset(-10),
        totalDays: "1", reason: "Bank work", status: "Rejected",
        hodActionedById: hodUser?.id, hodRemarks: "Quarterly closing — please reschedule.", hodActionedAt: tsOffset(-11),
      },
      {
        employeeId: emp6.id, leaveTypeId: el.id, fromDate: dateOffset(30), toDate: dateOffset(34),
        totalDays: "5", reason: "Travel to home town", status: "HOD Approved",
        hodActionedById: hodUser?.id, hodRemarks: "Approved at HOD level.", hodActionedAt: tsOffset(-1),
      },
    ]);
  }
  console.log("Leave seeded.");

  // ── Attendance — last 30 days ──────────────────────────────────────────
  const existingAtt = await db.select().from(attendanceRecordsTable);
  if (existingAtt.length === 0) {
    const attRows: Array<typeof attendanceRecordsTable.$inferInsert> = [];
    for (let d = -30; d <= -1; d++) {
      const dt = new Date();
      dt.setDate(dt.getDate() + d);
      const dow = dt.getDay(); // 0 Sun, 6 Sat
      const dateStr = dt.toISOString().slice(0, 10);
      for (const e of activeEmps) {
        if (dow === 0 || dow === 6) {
          attRows.push({ employeeId: e.id, attendanceDate: dateStr, status: "Week Off" });
          continue;
        }
        // 88% present, 6% half-day, 4% leave, 2% absent
        const r = Math.random();
        if (r < 0.88) {
          const inH = 9, inM = Math.floor(Math.random() * 30);
          const outH = 18, outM = Math.floor(Math.random() * 45);
          const inT = new Date(dt); inT.setHours(inH, inM, 0, 0);
          const outT = new Date(dt); outT.setHours(outH, outM, 0, 0);
          attRows.push({
            employeeId: e.id, attendanceDate: dateStr, status: "Present",
            signInTime: inT, signOutTime: outT,
            totalMinutesWorked: Math.round((outT.getTime() - inT.getTime()) / 60000) - 60,
            breakDurationMinutes: 60,
            signInTimezone: "Asia/Kolkata", signOutTimezone: "Asia/Kolkata",
          });
        } else if (r < 0.94) {
          const inT = new Date(dt); inT.setHours(9, 30, 0, 0);
          const outT = new Date(dt); outT.setHours(13, 30, 0, 0);
          attRows.push({
            employeeId: e.id, attendanceDate: dateStr, status: "Half-Day",
            signInTime: inT, signOutTime: outT, totalMinutesWorked: 240,
          });
        } else if (r < 0.98) {
          attRows.push({ employeeId: e.id, attendanceDate: dateStr, status: "On Leave" });
        } else {
          attRows.push({ employeeId: e.id, attendanceDate: dateStr, status: "Absent" });
        }
      }
    }
    // Today: clock-in for most active employees (no clock-out yet)
    const today = todayStr();
    for (const e of activeEmps.slice(0, 5)) {
      const inT = new Date(); inT.setHours(9, 18, 0, 0);
      attRows.push({
        employeeId: e.id, attendanceDate: today, status: "Present",
        signInTime: inT, signInTimezone: "Asia/Kolkata",
      });
    }
    // Insert in batches of 200
    for (let i = 0; i < attRows.length; i += 200) {
      await db.insert(attendanceRecordsTable).values(attRows.slice(i, i + 200));
    }

    // A regularization request
    if (emp6) {
      await db.insert(attendanceRegularizationsTable).values({
        employeeId: emp6.id, attendanceDate: dateOffset(-5),
        requestedSignIn: tsOffset(-5, 9, 30), requestedSignOut: tsOffset(-5, 18, 15),
        reason: "Forgot to clock-in due to client meeting in the morning.",
        status: "Pending",
      });
    }
  }
  console.log("Attendance seeded.");

  // ── Payroll: salary structures + 2 finalized runs ──────────────────────
  const existingStruct = await db.select().from(salaryStructuresTable);
  if (existingStruct.length === 0) {
    for (const e of activeEmps) {
      const annual = Number(e.ctc ?? "600000");
      const monthly = annual / 12;
      const basic = Math.round(monthly * 0.4);
      const hra = Math.round(monthly * 0.2);
      const special = Math.round(monthly * 0.25);
      const travel = Math.round(monthly * 0.05);
      const medical = Math.round(monthly * 0.05);
      const [struct] = await db.insert(salaryStructuresTable).values({
        employeeId: e.id, name: `${e.firstName} ${e.lastName} - Standard`,
        effectiveFrom: e.dateOfJoining ?? `${yr}-04-01`,
        grossCtc: String(Math.round(monthly)), annualCtc: String(annual),
        isActive: true, createdById: hrMgr?.id,
      }).returning();
      await db.insert(salaryComponentsTable).values([
        { salaryStructureId: struct.id, componentType: "Basic", componentName: "Basic Salary", amount: String(basic), isEarning: true, sequence: 1 },
        { salaryStructureId: struct.id, componentType: "HRA", componentName: "House Rent Allowance", amount: String(hra), percentageOfBasic: "50", isEarning: true, sequence: 2 },
        { salaryStructureId: struct.id, componentType: "Special Allowance", componentName: "Special Allowance", amount: String(special), isEarning: true, sequence: 3 },
        { salaryStructureId: struct.id, componentType: "Travel Allowance", componentName: "Conveyance", amount: String(travel), isEarning: true, sequence: 4 },
        { salaryStructureId: struct.id, componentType: "Medical Allowance", componentName: "Medical Allowance", amount: String(medical), isEarning: true, sequence: 5 },
        { salaryStructureId: struct.id, componentType: "PF Employee", componentName: "Provident Fund", amount: String(Math.min(1800, Math.round(basic * 0.12))), isEarning: false, sequence: 6 },
        { salaryStructureId: struct.id, componentType: "Professional Tax", componentName: "Professional Tax", amount: "200", isEarning: false, sequence: 7 },
      ]);
    }
  }
  const allStructs = await db.select().from(salaryStructuresTable);
  const structByEmp = new Map(allStructs.map((s) => [s.employeeId, s]));

  // Two finalized payroll runs: prev month, prev-prev month
  const existingRuns = await db.select().from(payrollRunsTable);
  if (existingRuns.length === 0) {
    const now = new Date();
    for (const monthOffset of [2, 1]) {
      const runDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const periodYear = runDate.getFullYear();
      const periodMonth = runDate.getMonth() + 1;
      let totGross = 0, totDed = 0, totNet = 0;
      const [run] = await db.insert(payrollRunsTable).values({
        periodYear, periodMonth, status: "Locked",
        initiatedById: payAdmin?.id, approvedById: superUser?.id,
        runAt: new Date(runDate.getFullYear(), runDate.getMonth(), 28),
        approvedAt: new Date(runDate.getFullYear(), runDate.getMonth(), 30),
        totalEmployees: activeEmps.length,
        totalGross: "0", totalDeductions: "0", totalNet: "0",
      }).returning();

      for (const e of activeEmps) {
        const struct = structByEmp.get(e.id);
        if (!struct) continue;
        const annual = Number(e.ctc ?? "600000");
        const monthly = annual / 12;
        const basic = Math.round(monthly * 0.4);
        const hra = Math.round(monthly * 0.2);
        const special = Math.round(monthly * 0.25);
        const travel = Math.round(monthly * 0.05);
        const medical = Math.round(monthly * 0.05);
        const gross = basic + hra + special + travel + medical;
        const pf = Math.min(1800, Math.round(basic * 0.12));
        const pt = 200;
        const tds = annual > 1000000 ? Math.round(monthly * 0.08) : 0;
        const ded = pf + pt + tds;
        const net = gross - ded;
        totGross += gross; totDed += ded; totNet += net;
        const [rec] = await db.insert(payrollRecordsTable).values({
          payrollRunId: run.id, employeeId: e.id, salaryStructureId: struct.id,
          workingDays: "22", presentDays: "22", leaveDays: "0", lopDays: "0",
          basic: String(basic), hra: String(hra), specialAllowance: String(special),
          travelAllowance: String(travel), medicalAllowance: String(medical),
          grossEarnings: String(gross), pfEmployee: String(pf), professionalTax: String(pt),
          tds: String(tds), totalDeductions: String(ded), netPay: String(net),
          status: "Paid", taxRegime: "New",
        }).returning();
        await db.insert(payslipsTable).values({
          payrollRecordId: rec.id, employeeId: e.id,
          periodYear, periodMonth,
          payslipData: { basic, hra, special, travel, medical, gross, pf, pt, tds, net },
        });
      }
      await db.update(payrollRunsTable).set({
        totalGross: String(totGross), totalDeductions: String(totDed), totalNet: String(totNet),
      }).where(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import("drizzle-orm")).eq(payrollRunsTable.id, run.id) as any
      );
    }

    // Current month draft run
    const cur = new Date();
    await db.insert(payrollRunsTable).values({
      periodYear: cur.getFullYear(), periodMonth: cur.getMonth() + 1,
      status: "Draft", initiatedById: payAdmin?.id, totalEmployees: 0,
    });
  }
  console.log("Payroll seeded.");

  // ── Performance: cycle + goals + appraisals ────────────────────────────
  const existingCycles = await db.select().from(performanceCyclesTable);
  if (existingCycles.length === 0) {
    const [cycle] = await db.insert(performanceCyclesTable).values({
      title: `FY ${yr}-${String(yr + 1).slice(2)} Annual Cycle`,
      cycleType: "Annual",
      startDate: `${yr}-04-01`, endDate: `${yr + 1}-03-31`,
      status: "Active", currentStage: "Mid Review",
      description: "Annual performance review cycle covering FY goals, quarterly check-ins, and 360 feedback.",
      createdBy: hrMgr?.id,
    }).returning();

    // 2-3 goals per active employee
    const goalTitles = [
      ["Ship Q1 Roadmap Features", "Deliver assigned epics on schedule with quality metrics", "30"],
      ["Mentor Junior Engineers", "Conduct weekly 1:1s, code reviews, and pair-programming sessions", "20"],
      ["Improve Code Quality", "Reduce production incidents by 30% through testing and reviews", "25"],
      ["Stakeholder Communication", "Run weekly demo, publish RFCs for major changes", "15"],
      ["Skills Development", "Complete certification in priority technology", "10"],
    ];
    for (const e of activeEmps.slice(0, 5)) {
      for (const [title, desc, weight] of goalTitles.slice(0, 3)) {
        const [g] = await db.insert(performanceGoalsTable).values({
          cycleId: cycle.id, employeeId: e.id,
          title, description: desc, weightage: weight,
          targetValue: "100%", measurementMethod: "Manager assessment + objective KPIs",
          status: "Active", assignedBy: hodUser?.id,
        }).returning();
        await db.insert(goalProgressTable).values({
          goalId: g.id, progressPercent: 30 + Math.floor(Math.random() * 50),
          commentary: "Mid-cycle progress update — on track.", updatedBy: hodUser?.id,
        });
      }
    }

    // Self appraisals + manager evals for emp1 (Arjun)
    if (emp1) {
      const arjunGoals = await db.select().from(performanceGoalsTable);
      const myGoals = arjunGoals.filter((g) => g.employeeId === emp1.id);
      for (const g of myGoals) {
        await db.insert(selfAppraisalsTable).values({
          goalId: g.id, employeeId: emp1.id, rating: 4,
          commentary: "Met all primary deliverables; some stretch goals slipped due to scope changes.",
        });
        await db.insert(managerEvaluationsTable).values({
          goalId: g.id, employeeId: emp1.id, rating: 4,
          commentary: "Strong execution. Demonstrated leadership during incident response.",
          evaluatedBy: hodUser?.id,
        });
      }
    }
  }
  console.log("Performance seeded.");

  // ── Helpdesk tickets ───────────────────────────────────────────────────
  const existingTix = await db.select().from(helpdeskTicketsTable);
  if (existingTix.length === 0 && emp1 && emp6 && emp8) {
    const tickets = await db.insert(helpdeskTicketsTable).values([
      {
        subject: "Laptop battery draining quickly", description: "My ThinkPad battery lasts only 2 hours now. Need replacement or repair.",
        category: "IT", priority: "Medium", status: "Open",
        raisedByEmployeeId: emp1.id, slaDeadline: tsOffset(2),
      },
      {
        subject: "Payslip not showing for last month", description: "I cannot see my March payslip in the ESS portal. Please assist.",
        category: "Payroll", priority: "High", status: "In Progress",
        raisedByEmployeeId: emp6.id, assignedToUserId: payAdmin?.id, slaDeadline: tsOffset(1),
      },
      {
        subject: "Update emergency contact details", description: "Need to update my emergency contact phone number.",
        category: "HR", priority: "Low", status: "Resolved",
        raisedByEmployeeId: emp8.id, assignedToUserId: hrExec?.id,
        resolvedAt: tsOffset(-2), slaDeadline: tsOffset(-1),
      },
      {
        subject: "Reimbursement claim for client travel", description: "Submitting receipts for Bangalore client visit on March 15.",
        category: "Finance", priority: "Medium", status: "Closed",
        raisedByEmployeeId: emp1.id, assignedToUserId: payAdmin?.id,
        resolvedAt: tsOffset(-7), closedAt: tsOffset(-5),
      },
      {
        subject: "VPN access not working from home", description: "Getting authentication errors when connecting to corporate VPN.",
        category: "IT", priority: "Urgent", status: "Open",
        raisedByEmployeeId: emp6.id, slaDeadline: tsOffset(0, 4),
      },
    ]).returning();

    if (tickets[1] && payAdmin && empUser) {
      await db.insert(ticketCommentsTable).values([
        { ticketId: tickets[1].id, authorId: payAdmin.id, message: "Looking into the payroll system — payslip generation is queued for re-run." },
        { ticketId: tickets[1].id, authorId: empUser.id, message: "Thanks for the update. When can I expect it?" },
      ]);
    }
    if (tickets[2] && hrExec) {
      await db.insert(ticketCommentsTable).values([
        { ticketId: tickets[2].id, authorId: hrExec.id, message: "Updated in employee record. Please verify in ESS." },
      ]);
    }
  }
  console.log("Helpdesk seeded.");

  // ── Onboarding (for the most recent employee Lakshmi) ──────────────────
  const existingChecklists = await db.select().from(onboardingChecklistsTable);
  if (existingChecklists.length === 0 && emp8) {
    const [checklist] = await db.insert(onboardingChecklistsTable).values({
      employeeId: emp8.id, status: "In Progress", completionPercentage: 60,
      joiningDate: emp8.dateOfJoining,
      welcomeEmailSentAt: tsOffset(-21),
      idCardGeneratedAt: tsOffset(-20),
    }).returning();

    await db.insert(onboardingTasksTable).values([
      { checklistId: checklist.id, title: "Send welcome email", category: "HR", assigneeRole: "hr_executive", completedAt: tsOffset(-21), completedById: hrExec?.id },
      { checklistId: checklist.id, title: "Generate employee ID card", category: "HR", assigneeRole: "hr_executive", completedAt: tsOffset(-20), completedById: hrExec?.id },
      { checklistId: checklist.id, title: "Create email and Slack accounts", category: "IT", assigneeRole: "it", completedAt: tsOffset(-19) },
      { checklistId: checklist.id, title: "Issue laptop and accessories", category: "IT", assigneeRole: "it", completedAt: tsOffset(-19) },
      { checklistId: checklist.id, title: "Department orientation session", category: "Department", assigneeRole: "hod", dueDate: dateOffset(2) },
      { checklistId: checklist.id, title: "Submit personal documents (PAN, Aadhaar, Bank)", category: "Employee", assigneeRole: "employee", dueDate: dateOffset(7) },
      { checklistId: checklist.id, title: "Complete code of conduct training", category: "HR", assigneeRole: "employee", dueDate: dateOffset(14) },
    ]);
  }
  console.log("Onboarding seeded.");

  // ── Document templates + issued documents ──────────────────────────────
  const existingTemplates = await db.select().from(documentTemplatesTable);
  if (existingTemplates.length === 0) {
    const [tplOffer] = await db.insert(documentTemplatesTable).values([
      {
        documentType: "Offer Letter", name: "Standard Offer Letter",
        companyName: "Automystics Technologies Pvt Ltd",
        companyAddress: "5th Floor, Tech Park, Chennai 600 113",
        bodyTemplate: "Dear {{firstName}} {{lastName}},\n\nWe are pleased to offer you the position of {{designation}} at Automystics Technologies, effective {{dateOfJoining}}. Your annual CTC will be ₹{{ctc}}.\n\nWelcome aboard!\n\nRegards,\nHR Team",
      },
      {
        documentType: "Experience Certificate", name: "Standard Experience Certificate",
        companyName: "Automystics Technologies Pvt Ltd",
        bodyTemplate: "This is to certify that {{firstName}} {{lastName}} (Employee ID: {{employeeId}}) was employed with Automystics Technologies as {{designation}} from {{dateOfJoining}} to {{lastWorkingDay}}. During this tenure, the employee was found to be sincere and hardworking.",
      },
      {
        documentType: "Appointment Letter", name: "Standard Appointment Letter",
        companyName: "Automystics Technologies Pvt Ltd",
        bodyTemplate: "Dear {{firstName}},\n\nFollowing your acceptance of our offer, we hereby confirm your appointment as {{designation}} with effect from {{dateOfJoining}}.",
      },
    ]).returning();

    if (tplOffer && emp8) {
      await db.insert(issuedDocumentsTable).values({
        employeeId: emp8.id, templateId: tplOffer.id, documentType: "Offer Letter",
        filename: `OfferLetter_${emp8.employeeId}.pdf`,
        generatedBy: hrMgr?.id,
        fieldValues: { firstName: emp8.firstName, lastName: emp8.lastName, designation: "Finance Analyst", dateOfJoining: emp8.dateOfJoining, ctc: emp8.ctc },
      });
    }
  }
  console.log("Documents seeded.");

  // ── Notifications: log entries + a few in-app for super_admin ──────────
  const existingNotifs = await db.select().from(notificationLogsTable).limit(1);
  if (existingNotifs.length === 0 && emp1) {
    await db.insert(notificationLogsTable).values([
      { channel: "email", eventType: "leave_approved", module: "leave", recipientEmail: emp1.email, recipientName: `${emp1.firstName} ${emp1.lastName}`, subject: "Your leave has been approved", body: "Your earned leave from " + dateOffset(15) + " to " + dateOffset(19) + " has been approved.", status: "sent", entityType: "leave_application", entityId: 1 },
      { channel: "email", eventType: "payslip_published", module: "payroll", recipientEmail: emp1.email, recipientName: `${emp1.firstName} ${emp1.lastName}`, subject: "Payslip available", body: "Your payslip for last month is now available in ESS.", status: "sent" },
      { channel: "in_app", eventType: "ticket_assigned", module: "helpdesk", recipientEmail: "ravi.kumar@automystics.com", recipientName: "Ravi Kumar", subject: "Ticket assigned", body: "A new payroll ticket has been assigned to you.", status: "sent" },
      { channel: "email", eventType: "onboarding_task_due", module: "onboarding", recipientEmail: emp8?.email ?? "", recipientName: "Lakshmi Iyer", subject: "Onboarding tasks pending", body: "Please complete pending onboarding tasks.", status: "sent" },
    ]);
  }
  if (superUser) {
    const existingUserNotifs = await db.select().from(userNotificationsTable).limit(1);
    if (existingUserNotifs.length === 0) {
      await db.insert(userNotificationsTable).values([
        { recipientUserId: superUser.id, title: "New leave application", message: "Kavitha Nair has applied for 2 days of casual leave.", entityType: "leave_application" },
        { recipientUserId: superUser.id, title: "Helpdesk SLA at risk", message: "Ticket #5 (VPN access) is approaching SLA deadline.", entityType: "ticket" },
        { recipientUserId: superUser.id, title: "Payroll run completed", message: "Last month's payroll run has been processed and locked.", entityType: "payroll_run" },
      ]);
    }
  }
  console.log("Notifications seeded.");

  console.log("✅ Seed complete.");
}

seed().catch(console.error).finally(() => process.exit(0));
