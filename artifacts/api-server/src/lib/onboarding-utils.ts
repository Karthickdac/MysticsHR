import { db } from "./db";
import {
  onboardingChecklistsTable,
  onboardingTasksTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export const DEFAULT_ONBOARDING_TASKS = [
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

export async function autoCreateOnboardingChecklist(
  employeeId: number,
  joiningDate: string | null | undefined
): Promise<boolean> {
  const existing = await db
    .select({ id: onboardingChecklistsTable.id })
    .from(onboardingChecklistsTable)
    .where(eq(onboardingChecklistsTable.employeeId, employeeId))
    .limit(1);

  if (existing.length > 0) return false;

  const [checklist] = await db
    .insert(onboardingChecklistsTable)
    .values({ employeeId, joiningDate: joiningDate ?? null })
    .returning();

  const taskDueDate = joiningDate ?? null;
  for (const t of DEFAULT_ONBOARDING_TASKS) {
    await db.insert(onboardingTasksTable).values({
      checklistId: checklist.id,
      title: t.title,
      category: t.category,
      assigneeRole: t.assigneeRole,
      dueDate: taskDueDate,
    });
  }

  return true;
}
