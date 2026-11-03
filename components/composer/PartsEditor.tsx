"use client";

import { useRef, useState } from "react";
import { updateAltText } from "@/app/actions/library";
import type { PostPart } from "@/lib/db/schema";
import { applyStyle, type TextStyle } from "@/lib/text";
import { EmojiButton } from "./EmojiButton";
import type { ComposerMedia, ComposerSnippet } from "./types";
import { uploadFile } from "./upload";

export type Counter = { label: string; count: number; max: number; color: string };

type Update = (fn: (parts: PostPart[]) => PostPart[]) => void;

type Props = {
  parts: PostPart[];
  /** Functional update, so async uploads never clobber newer edits. */
  update: Update;
  allowThread: boolean;
  media: Record<string, ComposerMedia>;
  onMedia: (m: ComposerMedia) => void;
  library: ComposerMedia[];
  snippets: ComposerSnippet[];
  counters: (text: string) => Counter[];
};

export function PartsEditor(props: Props) {
  const { parts, update, allowThread } = props;
  return (
    <div className="space-y-3">
      {parts.map((part, i) => (
        <PartEditor
          key={i}
          index={i}
          total={parts.length}
          part={part}
          change={(fn) => update((ps) => ps.map((p, j) => (j === i ? fn(p) : p)))}
          onRemove={() => update((ps) => ps.filter((_, j) => j !== i))}
          {...props}
        />
      ))}
      {allowThread && (
        <button type="button" className="btn" onClick={() => update((ps) => [...ps, { text: "", mediaIds: [] }])}>
          + Add to thread
        </button>
      )}
    </div>
  );
}

const STYLES: [TextStyle, string, string][] = [
  ["bold", "B", "Bold"],
  ["italic", "I", "Italic"],
  ["mono", "M", "Monospace"],
];

function PartEditor({
  index,
  total,
  part,
  change,
  onRemove,
  media,
  onMedia,
  library,
  snippets,
  counters,
}: Props & {
  index: number;
  total: number;
  part: PostPart;
  change: (fn: (p: PostPart) => PostPart) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [altFor, setAltFor] = useState<string | null>(null);

  /** Replace the current selection (or insert at the caret). */
  function replaceSelection(fn: (selected: string) => string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const next = fn(value.slice(s, e));
    change((p) => ({ ...p, text: value.slice(0, s) + next + value.slice(e) }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s, s + next.length);
    });
  }

  async function addFiles(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, progress: 0 }]);
      try {
        const m = await uploadFile(file, (progress) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress } : x))),
        );
        onMedia(m);
        change((p) => ({ ...p, mediaIds: [...p.mediaIds, m.mediaId] }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
  }

  const move = (from: number, to: number) =>
    change((p) => {
      const ids = [...p.mediaIds];
      const [x] = ids.splice(from, 1);
      ids.splice(to, 0, x);
      return { ...p, mediaIds: ids };
    });

  return (
    <div
      className="rounded-lg border border-border bg-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {total > 1 && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted">
          <span>Part {index + 1} of {total}</span>
          {index > 0 && (
            <button type="button" className="underline" onClick={onRemove}>Remove</button>
          )}
        </div>
      )}
      <textarea
        ref={ref}
        value={part.text}
        onChange={(e) => {
          const text = e.target.value;
          change((p) => ({ ...p, text }));
        }}
        rows={6}
        placeholder={index === 0 ? "What do you want to share?" : "Continue the thread…"}
        className="block w-full resize-y bg-transparent p-3 text-[15px] leading-relaxed outline-none"
        aria-label={`Post text, part ${index + 1}`}
      />

      {part.mediaIds.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          {part.mediaIds.map((id, i) => {
            const m = media[id];
            return (
              <div key={id} className="group relative h-24 w-24 overflow-hidden rounded-md border border-border bg-background">
                {m?.kind === "video" ? (
                  <video src={m.src} className="h-full w-full object-cover" muted preload="metadata" />
                ) : m ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.src} alt={m.altText} className="h-full w-full object-cover" />
                ) : (
                  <div className="p-2 text-xs text-muted">missing</div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-1 text-[11px] text-white">
                  <button type="button" onClick={() => setAltFor(altFor === id ? null : id)} title="Alt text">
                    ALT{m?.altText ? "✓" : ""}
                  </button>
                  {i > 0 && <button type="button" onClick={() => move(i, i - 1)} aria-label="Move left">◀</button>}
                  <button
                    type="button"
                    aria-label="Remove media"
                    onClick={() => change((p) => ({ ...p, mediaIds: p.mediaIds.filter((x) => x !== id) }))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {altFor && media[altFor] && (
        <div className="flex gap-2 px-3 pb-3">
          <input
            className="input"
            placeholder="Describe the image for people using screen readers"
            defaultValue={media[altFor].altText}
            onBlur={async (e) => {
              const altText = e.target.value;
              await updateAltText(altFor, altText);
              onMedia({ ...media[altFor], altText });
            }}
            autoFocus
          />
          <button type="button" className="btn" onClick={() => setAltFor(null)}>Done</button>
        </div>
      )}
      {uploads.map((u) => (
        <div key={u.name} className="px-3 pb-2 text-xs text-muted">
          Uploading {u.name}… {Math.round(u.progress * 100)}%
        </div>
      ))}
      {error && <p className="px-3 pb-2 text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
        {STYLES.map(([style, label, title]) => (
          <button
            key={style}
            type="button"
            className="btn px-2 font-mono"
            title={`${title} (select text first)`}
            onClick={() => replaceSelection((s) => applyStyle(s, style))}
          >
            {style === "italic" ? <i>{label}</i> : style === "bold" ? <b>{label}</b> : label}
          </button>
        ))}
        <EmojiButton onPick={(emoji) => replaceSelection(() => emoji)} />
        {snippets.length > 0 && (
          <select
            className="btn"
            value=""
            onChange={(e) => {
              const s = snippets.find((x) => x.snippetId === e.target.value);
              if (s) replaceSelection(() => (s.kind === "hashtags" ? ` ${s.body}` : s.body));
            }}
            aria-label="Insert snippet"
          >
            <option value="">Snippets…</option>
            {snippets.map((s) => (
              <option key={s.snippetId} value={s.snippetId}>
                {s.kind === "hashtags" ? "#" : "📝"} {s.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Upload</button>
        <button type="button" className="btn" onClick={() => dialog.current?.showModal()}>Library</button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          {counters(part.text).map((c) => (
            <span
              key={c.label}
              title={c.label}
              className={c.count > c.max ? "font-semibold text-red-600" : "text-muted"}
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.max - c.count}
            </span>
          ))}
        </div>
      </div>

      <dialog ref={dialog} className="m-auto w-[min(90vw,48rem)] rounded-lg border border-border bg-panel p-4 text-foreground backdrop:bg-black/40">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Media library</h2>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        {library.length === 0 && <p className="text-sm text-muted">No media yet. Upload some first.</p>}
        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {library.map((m) => (
            <button
              key={m.mediaId}
              type="button"
              className="aspect-square overflow-hidden rounded border border-border hover:ring-2 hover:ring-accent"
              onClick={() => {
                onMedia(m);
                change((p) => (p.mediaIds.includes(m.mediaId) ? p : { ...p, mediaIds: [...p.mediaIds, m.mediaId] }));
                dialog.current?.close();
              }}
            >
              {m.kind === "video" ? (
                <video src={m.src} className="h-full w-full object-cover" muted preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.src} alt={m.altText} className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
