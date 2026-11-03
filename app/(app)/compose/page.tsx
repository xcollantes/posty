import { Composer } from "@/components/composer/Composer";
import { requireUser } from "@/lib/auth";
import { composerData } from "./data";

export default async function NewPostPage({ searchParams }: PageProps<"/compose">) {
  await requireUser();
  const { at, account } = await searchParams;
  const data = await composerData();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New post</h1>
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
    </div>
  );
}
