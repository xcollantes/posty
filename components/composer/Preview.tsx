import type { PostPart } from "@/lib/db/schema";
import { NETWORKS } from "@/lib/networks/catalog";
import type { ComposerAccount, ComposerMedia } from "./types";

/** Generic per-account preview card (deliberately not a copy of any network's UI). */
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
    <div className="overflow-hidden rounded-lg border border-border bg-panel">
      <div className="h-1" style={{ background: info.color }} />
      {shown.map((part, i) => (
        <div key={i} className={i > 0 ? "border-t border-dashed border-border" : ""}>
          <div className="flex items-center gap-2 px-3 pt-3">
            <Avatar account={account} />
            <div className="min-w-0 text-sm leading-tight">
              <div className="truncate font-medium">{account.name}</div>
              <div className="truncate text-xs text-muted">
                {info.label}
                {account.username ? ` · ${account.username}` : ""}
              </div>
            </div>
          </div>
          <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{part.text || <span className="text-muted">…</span>}</p>
          {part.mediaIds.length > 0 && (
            <div className={`grid gap-0.5 ${part.mediaIds.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {part.mediaIds.slice(0, 4).map((id, j) => {
                const m = media[id];
                if (!m) return null;
                const more = j === 3 && part.mediaIds.length > 4 ? part.mediaIds.length - 4 : 0;
                return (
                  <div key={id} className="relative aspect-square bg-background">
                    {m.kind === "video" ? (
                      <video src={m.src} className="h-full w-full object-cover" muted preload="metadata" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.src} alt={m.altText} className="h-full w-full object-cover" />
                    )}
                    {more > 0 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">
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
    </div>
  );
}

export function Avatar({ account, size = 32 }: { account: Pick<ComposerAccount, "avatar" | "name" | "network">; size?: number }) {
  const info = NETWORKS[account.network];
  return account.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={account.avatar} alt="" width={size} height={size} className="shrink-0 rounded-full" style={{ outline: `2px solid ${info.color}` }} />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ width: size, height: size, background: info.color }}
    >
      {account.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
