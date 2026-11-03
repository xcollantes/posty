"use client";

import { useRef, useState } from "react";
import { deleteMedia, updateAltText } from "@/app/actions/library";
import type { ComposerMedia } from "@/components/composer/types";
import { uploadFile } from "@/components/composer/upload";

type Item = ComposerMedia & { sizeBytes?: number };

export function MediaGrid({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const m = await uploadFile(file, (p) => setBusy(`Uploading ${file.name}… ${Math.round(p * 100)}%`));
        setItems((all) => [m, ...all]);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setBusy(null);
  }

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => input.current?.click()}>Upload</button>
        <span className="text-sm text-muted">or drop files anywhere here. JPEG, PNG, WebP, GIF, MP4, MOV up to 1 GB.</span>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>
      {busy && <p className="text-sm text-muted">{busy}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {items.length === 0 && <p className="text-sm text-muted">No media yet.</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => (
          <li key={m.mediaId} className="card space-y-2 p-2">
            <div className="aspect-square overflow-hidden rounded bg-background">
              {m.kind === "video" ? (
                <video src={m.src} controls preload="metadata" className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.src} alt={m.altText} className="h-full w-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="truncate text-xs text-muted" title={m.originalName}>
              {m.originalName}
              {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
            </div>
            <input
              className="input text-xs"
              placeholder="Alt text"
              defaultValue={m.altText}
              aria-label={`Alt text for ${m.originalName}`}
              onBlur={(e) => e.target.value !== m.altText && updateAltText(m.mediaId, e.target.value)}
            />
            <button
              className="text-xs text-red-600 underline cursor-pointer"
              onClick={async () => {
                if (!window.confirm("Delete this file?")) return;
                const res = await deleteMedia(m.mediaId);
                if (res.error) setError(res.error);
                else setItems((all) => all.filter((x) => x.mediaId !== m.mediaId));
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
