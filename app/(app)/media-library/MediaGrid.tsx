"use client";

import { useRef, useState } from "react";
import { deleteMedia, updateAltText } from "@/app/actions/library";
import type { ComposerMedia } from "@/components/composer/types";
import { uploadFile } from "@/components/composer/upload";

export function MediaGrid({ initial }: { initial: ComposerMedia[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const m = await uploadFile(file, (p) => setBusy(`Uploading ${file.name}: ${Math.round(p * 100)}%`));
        setItems((all) => [m, ...all]);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setBusy(null);
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn" onClick={() => input.current?.click()}>
          Upload
        </button>
        <span className="hint">or drop files on this page. JPEG, PNG, WebP, GIF, MP4 or MOV, up to 1 GB.</span>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>
      {busy && <p className="mt-2 text-sm text-muted">{busy}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="mt-6 text-muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-5 gap-y-7">
          {items.map((m) => (
            <li key={m.mediaId} className="min-w-0 text-sm">
              <div className="aspect-square overflow-hidden rounded-[3px] border border-line bg-soft">
                {m.kind === "video" ? (
                  <video src={m.src} controls preload="metadata" className="size-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.src} alt={m.altText} className="size-full object-cover" loading="lazy" />
                )}
              </div>
              <p className="mt-1.5 truncate" title={m.originalName}>
                {m.originalName}
              </p>
              {m.width && m.height && (
                <p className="text-xs text-muted">
                  {m.width} × {m.height}
                </p>
              )}
              <input
                className="input mt-1.5 py-0.5 text-sm"
                placeholder="Alt text"
                defaultValue={m.altText}
                aria-label={`Alt text for ${m.originalName}`}
                onBlur={(e) => e.target.value !== m.altText && updateAltText(m.mediaId, e.target.value)}
              />
              <button
                className="danger-btn mt-1 text-xs"
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
      )}
    </div>
  );
}
