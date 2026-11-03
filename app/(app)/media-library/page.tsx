import { desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { rowToMedia } from "@/components/composer/media";
import { MediaGrid } from "./MediaGrid";

export default async function MediaLibraryPage() {
  await requireUser();
  const rows = await db.select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(500);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Media</h1>
      <MediaGrid initial={rows.map((r) => ({ ...rowToMedia(r), sizeBytes: r.sizeBytes }))} />
    </div>
  );
}
