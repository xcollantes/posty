import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { rowToMedia } from "@/components/composer/media";
import { Page } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspaces";
import { MediaGrid } from "./MediaGrid";

export const metadata: Metadata = { title: "Media" };

export default async function MediaLibraryPage() {
  const { workspaceId } = await requireWorkspace();
  const rows = await db
    .select()
    .from(schema.media)
    .where(eq(schema.media.workspaceId, workspaceId))
    .orderBy(desc(schema.media.createdAt))
    .limit(500);
  return (
    <Page title="Media" description="Images and videos you can attach to posts.">
      <MediaGrid initial={rows.map(rowToMedia)} />
    </Page>
  );
}
