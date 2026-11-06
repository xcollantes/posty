import type { Metadata } from "next";
import { Composer } from "@/components/composer/Composer";
import { Page } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspaces";
import { composerData } from "./data";

export const metadata: Metadata = { title: "New post" };

export default async function NewPostPage({ searchParams }: PageProps<"/compose">) {
  const { user, workspaceId } = await requireWorkspace();
  const { at, account } = await searchParams;
  const data = await composerData(workspaceId, user.timezone);
  return (
    <Page title="New post">
      <Composer
        {...data}
        initial={{
          status: "draft",
          parts: [{ text: "", mediaIds: [] }],
          targets:
            typeof account === "string"
              ? [{ socialAccountId: account, override: null, options: {} }]
              : [],
          tagIds: [],
          scheduledAt: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null,
        }}
      />
    </Page>
  );
}
