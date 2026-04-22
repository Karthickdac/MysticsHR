import { createClerkClient } from "@clerk/express";
import { db } from "../src/lib/db";
import { hrmsUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.EMAIL?.trim().toLowerCase();
  const firstName = process.env.FIRST_NAME?.trim() || "Super";
  const lastName = process.env.LAST_NAME?.trim() || "Admin";
  const password = process.env.PASSWORD?.trim() || "DemoTest123!@#";

  if (!email) {
    console.error("Missing EMAIL env var.");
    console.error('Usage: EMAIL=you@example.com FIRST_NAME=John LAST_NAME=Doe PASSWORD="StrongPass123!" pnpm dlx tsx scripts/add-super-admin.ts');
    process.exit(1);
  }

  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.error("CLERK_SECRET_KEY missing from environment.");
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey: secret });

  let clerkUserId: string;
  const existing = await clerk.users.getUserList({ emailAddress: [email] });
  if (existing.data.length > 0) {
    clerkUserId = existing.data[0].id;
    console.log(`✓ Clerk user already exists: ${email} (${clerkUserId})`);
    try {
      await clerk.users.updateUser(clerkUserId, { password, skipPasswordChecks: true } as any);
      console.log("  ↪ password reset to provided value");
    } catch (e: any) {
      console.log(`  ! could not reset password: ${e?.message ?? e}`);
    }
  } else {
    const created = await clerk.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      lastName,
      skipPasswordChecks: true,
      skipPasswordRequirement: false,
    } as any);
    clerkUserId = created.id;
    console.log(`+ Created Clerk user: ${email} (${clerkUserId})`);
  }

  // Force-verify all email addresses on the account so sign-in skips verification.
  try {
    const fresh = await clerk.users.getUser(clerkUserId);
    for (const ea of fresh.emailAddresses ?? []) {
      if (!ea.verification || ea.verification.status !== "verified") {
        await clerk.emailAddresses.updateEmailAddress(ea.id, { verified: true } as any);
        console.log(`  ↪ email verified: ${ea.emailAddress}`);
      }
    }
  } catch (e: any) {
    console.log(`  ! could not verify email: ${e?.message ?? e}`);
  }

  // Upsert into hrms_users with role super_admin.
  const fullName = `${firstName} ${lastName}`.trim();
  const existingHrms = await db
    .select()
    .from(hrmsUsersTable)
    .where(eq(hrmsUsersTable.email, email))
    .limit(1);

  if (existingHrms.length > 0) {
    await db
      .update(hrmsUsersTable)
      .set({
        clerkUserId,
        role: "super_admin",
        name: fullName,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(hrmsUsersTable.email, email));
    console.log(`✓ Upgraded existing HRMS user to super_admin: ${email}`);
  } else {
    await db.insert(hrmsUsersTable).values({
      clerkUserId,
      email,
      name: fullName,
      role: "super_admin",
      isActive: true,
    });
    console.log(`+ Inserted new HRMS user as super_admin: ${email}`);
  }

  console.log("\nDone. Sign in at your site with:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
