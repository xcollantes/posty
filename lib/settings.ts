import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}
