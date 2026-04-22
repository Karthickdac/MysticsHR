import { createClerkClient } from "@clerk/express";
import { db } from "../src/lib/db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const DEMO_PASSWORD = "DemoTest123!@#";

const seededUsers = [
  { email: "arjun.sharma@automystics.com", firstName: "Arjun", lastName: "Sharma", role: "super_admin" },
  { email: "priya.v@automystics.com", firstName: "Priya", lastName: "Venkataraman", role: "hr_manager" },
  { email: "ravi.kumar@automystics.com", firstName: "Ravi", lastName: "Kumar", role: "payroll_admin" },
  { email: "meena.r@automystics.com", firstName: "Meena", lastName: "Rajesh", role: "hr_executive" },
  { email: "suresh.b@automystics.com", firstName: "Suresh", lastName: "Babu", role: "hod" },
  { email: "kavitha.n@automystics.com", firstName: "Kavitha", lastName: "Nair", role: "employee" },
];

async function main() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY missing");

  const clerk = createClerkClient({ secretKey: secret });

  for (const u of seededUsers) {
    let clerkUserId: string | null = null;

    const existing = await clerk.users.getUserList({ emailAddress: [u.email] });
    if (existing.data.length > 0) {
      const existingUser = existing.data[0];
      clerkUserId = existingUser.id;
      console.log(`✓ Already exists in Clerk: ${u.email} (${clerkUserId})`);
      try {
        await clerk.users.updateUser(existingUser.id, { password: DEMO_PASSWORD, skipPasswordChecks: true } as any);
        console.log(`  ↪ password reset`);
      } catch (e: any) {
        console.log(`  ! could not reset password: ${e?.message ?? e}`);
      }
    } else {
      try {
        const created = await clerk.users.createUser({
          emailAddress: [u.email],
          password: DEMO_PASSWORD,
          firstName: u.firstName,
          lastName: u.lastName,
          skipPasswordChecks: true,
          skipPasswordRequirement: false,
        } as any);
        clerkUserId = created.id;
        console.log(`+ Created in Clerk: ${u.email} (${clerkUserId})`);
      } catch (e: any) {
        console.log(`✗ Failed to create ${u.email}: ${e?.errors?.[0]?.message ?? e?.message ?? e}`);
        continue;
      }
    }

    if (clerkUserId) {
      const result = await db
        .update(hrmsUsersTable)
        .set({ clerkUserId, updatedAt: new Date() })
        .where(eq(hrmsUsersTable.email, u.email))
        .returning();
      if (result.length > 0) {
        console.log(`  ↪ HRMS user linked (role: ${result[0].role})`);
      } else {
        console.log(`  ! No HRMS user found for ${u.email}`);
      }
    }
  }

  console.log("\nDone. Sign in with any of the above emails using password:");
  console.log(`  ${DEMO_PASSWORD}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
