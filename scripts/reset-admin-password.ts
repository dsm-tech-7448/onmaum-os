import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD must be set in .env.local");
  }

  const passwordHash = await hashPassword(password);

  const [updated] = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email });

  if (!updated) {
    throw new Error(`No user found with email ${email}`);
  }

  console.log(`Password updated for ${updated.email}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Password reset failed:", error);
  process.exit(1);
});
