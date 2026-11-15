/**
 * Run database migrations, then seed the first admin from ADMIN_EMAIL when
 * no user exists. Runs before the app server starts.
 */
import path from "node:path";
import { count } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, schema } from "@/lib/db";

async function main() {
  await migrate(db, { migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR ?? "drizzle") });
  console.log("migrations applied");

  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n === 0) {
    const email = process.env.ADMIN_EMAIL;
    if (!email) throw new Error("No users yet: set ADMIN_EMAIL");
    await db.insert(schema.users).values({
      email: email.toLowerCase(),
      name: email.split("@")[0],
      timezone: process.env.TZ || "UTC",
    });
    console.log(
      `created admin ${email}. Get a link to create your passkey with: ` +
        `docker compose exec app node dist/scripts/signin-link.mjs ${email}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
