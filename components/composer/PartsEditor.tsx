"use client";

import { ArrowLeft, Bold, Code, Hash, ImagePlus, Images, Italic, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { updateAltText } from "@/app/actions/library";
import { ExpandableImage } from "@/components/ExpandableImage";
import type { PostPart } from "@/lib/db/schema";
import { applyStyle, type TextStyle } from "@/lib/text";
import { EmojiButton } from "./EmojiButton";
import type { ComposerMedia, ComposerSnippet } from "./types";
import { uploadFile } from "./upload";

export type Counter = { label: string; count: number; max: number };

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
    <div className="space-y-6">
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
        <button
          type="button"
          className="link-btn inline-flex items-center gap-1.5 text-sm"
          onClick={() => update((ps) => [...ps, { text: "", mediaIds: [] }])}
        >
          <Plus className="size-4" />
          Add another post to the thread
        </button>
      )}
    </div>
  );
}

// Networks only take plain text, so "rich text" means Unicode letter styles.
const STYLES: [TextStyle, string, LucideIcon][] = [
  ["bold", "Bold", Bold],
  ["italic", "Italic", Italic],
  ["mono", "Mono", Code],
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
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {total > 1 && (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="chip bg-soft text-muted">
            {index + 1} of {total}
          </span>
          {index > 0 && (
            <button type="button" className="danger-btn inline-flex items-center gap-1" onClick={onRemove}>
              <Trash2 className="size-3.5" />
              Remove
            </button>
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
        rows={index === 0 ? 7 : 4}
        placeholder={index === 0 ? "Write your post…" : ""}
        className="input block resize-y px-3.5 py-3 text-[15px] leading-relaxed"
        aria-label={total > 1 ? `Post ${index + 1} of ${total}` : "Post text"}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1 text-sm">
        {STYLES.map(([style, label, Icon]) => (
          <button
            key={style}
            type="button"
            className="icon-btn"
            aria-label={label}
            title={`${label}: select some text first`}
            onClick={() => replaceSelection((s) => applyStyle(s, style))}
          >
            <Icon className="size-4" />
          </button>
        ))}
        <EmojiButton onPick={(emoji) => replaceSelection(() => emoji)} />
        <span className="mx-1 h-5 w-px bg-line" />
        <button
          type="button"
          className="icon-btn"
          aria-label="Add images or video"
          title="Add images or video"
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="size-4" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Media library"
          title="Media library"
          onClick={() => dialog.current?.showModal()}
        >
          <Images className="size-4" />
        </button>
        {snippets.length > 0 && (
          <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 font-semibold text-muted hover:bg-soft hover:text-fg">
            <Hash className="size-4" />
            <select
              className="cursor-pointer bg-transparent [field-sizing:content]"
              value=""
              onChange={(e) => {
                const s = snippets.find((x) => x.snippetId === e.target.value);
                if (s) replaceSelection(() => (s.kind === "hashtags" ? ` ${s.body}` : s.body));
              }}
              aria-label="Insert snippet"
            >
              <option value="">Insert snippet</option>
              {snippets.map((s) => (
                <option key={s.snippetId} value={s.snippetId}>
                  {s.name}
                  {s.kind === "hashtags" ? " (hashtags)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <span className="ml-auto flex flex-wrap gap-1.5">
          {counters(part.text).map((c) => (
            <span
              key={c.label}
              title={`${c.count} of ${c.max} characters`}
              className={`chip tabular-nums ${c.count > c.max ? "bg-danger/12 text-danger" : "bg-soft text-muted"}`}
            >
              {c.label} {c.max - c.count}
            </span>
          ))}
        </span>
      </div>

      {part.mediaIds.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-3">
          {part.mediaIds.map((id, i) => {
            const m = media[id];
            return (
              <li key={id} className="w-28 text-xs">
                <div className="size-28 overflow-hidden rounded-xl border border-line bg-soft">
                  {m?.kind === "video" ? (
                    <video src={m.src} className="size-full object-cover" muted preload="metadata" />
                  ) : m ? (
                    <ExpandableImage src={m.src} alt={m.altText} className="size-full object-cover" />
                  ) : (
                    <p className="p-2 text-muted">Missing file</p>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-0.5">
                  <button type="button" className="link-btn mr-auto" onClick={() => setAltFor(altFor === id ? null : id)}>
                    {m?.altText ? "Alt text" : "Add alt"}
                  </button>
                  {i > 0 && (
                    <button
                      type="button"
                      className="icon-btn size-6"
                      aria-label="Move earlier"
                      title="Move earlier"
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowLeft className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger size-6"
                    aria-label="Remove"
                    title="Remove"
                    onClick={() => change((p) => ({ ...p, mediaIds: p.mediaIds.filter((x) => x !== id) }))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {altFor && media[altFor] && (
        <div className="mt-3 flex max-w-xl gap-2">
          <input
            className="input"
            aria-label="Alt text"
            placeholder="Describe the image for people who can't see it"
            defaultValue={media[altFor].altText}
            onBlur={async (e) => {
              const altText = e.target.value;
              await updateAltText(altFor, altText);
              onMedia({ ...media[altFor], altText });
            }}
            autoFocus
          />
          <button type="button" className="btn" onClick={() => setAltFor(null)}>
            Done
          </button>
        </div>
      )}
      {uploads.map((u) => (
        <p key={u.name} className="mt-2 text-sm text-muted">
          Uploading {u.name}: {Math.round(u.progress * 100)}%
        </p>
      ))}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <dialog
        ref={dialog}
        className="m-auto w-[min(92vw,46rem)] rounded-2xl border border-line bg-bg p-5 text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2>Media library</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            title="Close"
            onClick={() => dialog.current?.close()}
          >
            <X className="size-4" />
          </button>
        </div>
        {library.length === 0 && <p className="hint">Nothing uploaded yet.</p>}
        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {library.map((m) => (
            <button
              key={m.mediaId}
              type="button"
              title={m.originalName}
              className="aspect-square cursor-pointer overflow-hidden rounded-xl border border-line hover:border-link"
              onClick={() => {
                onMedia(m);
                change((p) => (p.mediaIds.includes(m.mediaId) ? p : { ...p, mediaIds: [...p.mediaIds, m.mediaId] }));
                dialog.current?.close();
              }}
            >
              {m.kind === "video" ? (
                <video src={m.src} className="size-full object-cover" muted preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.src} alt={m.altText} className="size-full object-cover" />
              )}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
