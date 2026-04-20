import { db } from "./lib/db";
import {
  departmentsTable,
  designationsTable,
  employeesTable,
  hrmsUsersTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const [engDept, hrDept, financeDept, techDept, marketingDept] = await db
    .insert(departmentsTable)
    .values([
      { name: "Engineering", code: "ENG", description: "Product engineering and development" },
      { name: "Human Resources", code: "HR", description: "HR operations and talent management" },
      { name: "Finance", code: "FIN", description: "Finance, accounting, and payroll" },
      { name: "Technology", code: "TECH", description: "IT infrastructure and systems" },
      { name: "Marketing", code: "MKT", description: "Marketing and brand communications" },
    ])
    .onConflictDoNothing()
    .returning();

  console.log("Departments seeded.");

  const [swDes, srSwDes, hrExecDes, hrMgrDes, payDes, techLeadDes, mktDes, finDes] = await db
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
    .onConflictDoNothing()
    .returning();

  console.log("Designations seeded.");

  const [emp1, emp2, emp3, emp4, emp5, emp6, emp7, emp8] = await db
    .insert(employeesTable)
    .values([
      {
        employeeId: "AMT-2024-001",
        firstName: "Arjun",
        lastName: "Sharma",
        email: "arjun.sharma@automystics.com",
        phone: "+91 98765 43210",
        gender: "Male",
        departmentId: engDept?.id,
        designationId: srSwDes?.id,
        employmentType: "Permanent",
        status: "Active",
        dateOfJoining: "2024-01-15",
        location: "Chennai",
      },
      {
        employeeId: "AMT-2024-002",
        firstName: "Priya",
        lastName: "Venkataraman",
        email: "priya.v@automystics.com",
        phone: "+91 87654 32109",
        gender: "Female",
        departmentId: hrDept?.id,
        designationId: hrMgrDes?.id,
        employmentType: "Permanent",
        status: "Active",
        dateOfJoining: "2024-02-01",
        location: "Chennai",
      },
      {
        employeeId: "AMT-2024-003",
        firstName: "Ravi",
        lastName: "Kumar",
        email: "ravi.kumar@automystics.com",
        phone: "+91 76543 21098",
        gender: "Male",
        departmentId: financeDept?.id,
        designationId: payDes?.id,
        employmentType: "Permanent",
        status: "Active",
        dateOfJoining: "2024-03-10",
        location: "Bangalore",
      },
      {
        employeeId: "AMT-2024-004",
        firstName: "Meena",
        lastName: "Rajesh",
        email: "meena.r@automystics.com",
        phone: "+91 65432 10987",
        gender: "Female",
        departmentId: hrDept?.id,
        designationId: hrExecDes?.id,
        employmentType: "Permanent",
        status: "Active",
        dateOfJoining: "2024-04-05",
        location: "Chennai",
      },
      {
        employeeId: "AMT-2024-005",
        firstName: "Suresh",
        lastName: "Babu",
        email: "suresh.b@automystics.com",
        phone: "+91 54321 09876",
        gender: "Male",
        departmentId: techDept?.id,
        designationId: techLeadDes?.id,
        employmentType: "Permanent",
        status: "Active",
        dateOfJoining: "2024-05-20",
        location: "Hyderabad",
      },
      {
        employeeId: "AMT-2025-006",
        firstName: "Kavitha",
        lastName: "Nair",
        email: "kavitha.n@automystics.com",
        phone: "+91 43210 98765",
        gender: "Female",
        departmentId: engDept?.id,
        designationId: swDes?.id,
        employmentType: "Probation",
        status: "Active",
        dateOfJoining: "2025-01-08",
        location: "Chennai",
      },
      {
        employeeId: "AMT-2025-007",
        firstName: "Dinesh",
        lastName: "Murugan",
        email: "dinesh.m@automystics.com",
        phone: "+91 32109 87654",
        gender: "Male",
        departmentId: marketingDept?.id,
        designationId: mktDes?.id,
        employmentType: "Contract",
        status: "Notice Period",
        dateOfJoining: "2025-02-15",
        location: "Chennai",
      },
      {
        employeeId: "AMT-2026-008",
        firstName: "Lakshmi",
        lastName: "Iyer",
        email: "lakshmi.i@automystics.com",
        phone: "+91 21098 76543",
        gender: "Female",
        departmentId: financeDept?.id,
        designationId: finDes?.id,
        employmentType: "Intern",
        status: "Active",
        dateOfJoining: "2026-04-01",
        location: "Chennai",
      },
    ])
    .onConflictDoNothing()
    .returning();

  console.log("Employees seeded.");

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
  console.log("Seed complete.");
}

seed().catch(console.error).finally(() => process.exit(0));
