import type { PostPart } from "@/lib/db/schema";
import { NETWORKS } from "@/lib/networks/catalog";
import type { ComposerAccount, ComposerMedia } from "./types";

/** Roughly how the post will read on one account. Plain on purpose. */
export function Preview({
  account,
  parts,
  media,
}: {
  account: ComposerAccount;
  parts: PostPart[];
  media: Record<string, ComposerMedia>;
}) {
  const info = NETWORKS[account.network];
  const shown = info.threads ? parts : parts.slice(0, 1);
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-bg">
      <header className="border-b border-line bg-soft px-3 py-2 text-xs font-semibold text-muted">{info.label}</header>
      {shown.map((part, i) => (
        <div key={i} className={`px-3 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
          <div className="flex items-center gap-2">
            <Avatar account={account} />
            <div className="min-w-0 text-sm leading-tight">
              <div className="truncate font-semibold">{account.name}</div>
              {account.username && <div className="truncate text-xs text-muted">{account.username}</div>}
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {part.text || <span className="text-muted">Nothing written yet.</span>}
          </p>
          {part.mediaIds.length > 0 && (
            <div
              className={`mt-2 grid gap-0.5 overflow-hidden rounded-lg ${part.mediaIds.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
            >
              {part.mediaIds.slice(0, 4).map((id, j) => {
                const m = media[id];
                if (!m) return null;
                const more = j === 3 && part.mediaIds.length > 4 ? part.mediaIds.length - 4 : 0;
                return (
                  <div key={id} className="relative aspect-square bg-soft">
                    {m.kind === "video" ? (
                      <video src={m.src} className="size-full object-cover" muted preload="metadata" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.src} alt={m.altText} className="size-full object-cover" />
                    )}
                    {more > 0 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                        +{more}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </article>
  );
}

export function Avatar({ account, size = 28 }: { account: Pick<ComposerAccount, "avatar" | "name">; size?: number }) {
  return account.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={account.avatar} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" />
  ) : (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[image:var(--grad-cta)] text-xs font-bold text-white"
      style={{ width: size, height: size }}
    >
      {account.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
