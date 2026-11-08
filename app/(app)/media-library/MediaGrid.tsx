"use client";

import { CloudUpload, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { deleteMedia, updateAltText } from "@/app/actions/library";
import { ExpandableImage } from "@/components/ExpandableImage";
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
      <div className="card p-5">
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line px-6 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-[image:var(--grad-cta)] text-white">
            <CloudUpload className="size-6" />
          </span>
          <div>
            <p className="font-semibold">Drop files here</p>
            <p className="hint mt-0.5">JPEG, PNG, WebP, GIF, MP4 or MOV, up to 1 GB.</p>
          </div>
          <button className="btn-primary" onClick={() => input.current?.click()}>
            Upload
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
          {busy && <p className="text-sm text-muted">{busy}</p>}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-center text-muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {items.map((m) => (
            <li key={m.mediaId} className="card min-w-0 overflow-hidden">
              <div className="aspect-square bg-soft">
                {m.kind === "video" ? (
                  <video src={m.src} controls preload="metadata" className="size-full object-cover" />
                ) : (
                  <ExpandableImage src={m.src} alt={m.altText} className="size-full object-cover" />
                )}
              </div>
              <div className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={m.originalName}>
                      {m.originalName}
                    </p>
                    {m.width && m.height && (
                      <p className="text-xs text-muted">
                        {m.width} × {m.height}
                      </p>
                    )}
                  </div>
                  <button
                    className="icon-btn icon-btn-danger"
                    aria-label={`Delete ${m.originalName}`}
                    title="Delete"
                    onClick={async () => {
                      if (!window.confirm("Delete this file?")) return;
                      const res = await deleteMedia(m.mediaId);
                      if (res.error) setError(res.error);
                      else setItems((all) => all.filter((x) => x.mediaId !== m.mediaId));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <input
                  className="input py-1.5"
                  placeholder="Alt text"
                  defaultValue={m.altText}
                  aria-label={`Alt text for ${m.originalName}`}
                  onBlur={(e) => e.target.value !== m.altText && updateAltText(m.mediaId, e.target.value)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
