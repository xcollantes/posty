import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { rowToMedia } from "@/components/composer/media";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { MediaGrid } from "./MediaGrid";

export const metadata: Metadata = { title: "Media" };

export default async function MediaLibraryPage() {
  await requireUser();
  const rows = await db.select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(500);
  return (
    <div>
      <h1>Media</h1>
      <MediaGrid initial={rows.map(rowToMedia)} />
    </div>
  );
}
