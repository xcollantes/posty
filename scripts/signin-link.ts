/**
 * Print a one-time link that lets a user create a passkey. Use it for the
 * first sign-in, and to get back in after losing every device.
 *
 *   node dist/scripts/signin-link.mjs you@example.com
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { issueSignInLink, SIGN_IN_LINK_DAYS } from "@/lib/passkeys";

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error("Usage: signin-link <email>");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw new Error(`No user with email ${email}`);
  console.log(`Open this link to create a passkey (one use, valid ${SIGN_IN_LINK_DAYS} days):`);
  console.log(await issueSignInLink(user.userId));
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
