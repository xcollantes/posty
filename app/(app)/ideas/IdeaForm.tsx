"use client";

import { ImagePlus, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { moveIdea, saveIdeaForm } from "@/app/actions/ideas";
import { ActionForm } from "@/components/ActionForm";
import type { ComposerMedia } from "@/components/composer/types";
import { uploadFile } from "@/components/composer/upload";
import { NETWORKS, NETWORK_IDS } from "@/lib/networks/catalog";

type Group = { ideaGroupId: string; name: string };

export type IdeaFormValues = {
  ideaId: string;
  title: string;
  text: string;
  networks: string[];
  tags: string;
  ideaGroupId: string | null;
  /** YYYY-MM-DD in the user's timezone. */
  targetAt: string;
};

/** Add an idea, or edit one when `initial` is given. */
export function IdeaForm({
  groups,
  initial,
  initialMedia = [],
}: {
  groups: Group[];
  initial?: IdeaFormValues;
  initialMedia?: ComposerMedia[];
}) {
  const [media, setMedia] = useState(initialMedia);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const m = await uploadFile(file, (p) => setBusy(`Uploading ${file.name}: ${Math.round(p * 100)}%`));
        setMedia((all) => [...all, m]);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setBusy(null);
  }

  return (
    <ActionForm action={saveIdeaForm} submitLabel={initial ? "Save idea" : "Add idea"} className="space-y-4">
      {initial && <input type="hidden" name="ideaId" value={initial.ideaId} />}
      {media.map((m) => (
        <input key={m.mediaId} type="hidden" name="mediaId" value={m.mediaId} />
      ))}

      <label className="block text-sm font-semibold">
        Title
        <input name="title" className="input mt-1.5" maxLength={300} defaultValue={initial?.title} />
      </label>
      <label className="block text-sm font-semibold">
        Text
        <textarea name="text" rows={4} className="input mt-1.5" defaultValue={initial?.text} />
      </label>

      <div className="text-sm">
        <p className="font-semibold">Files</p>
        {media.length > 0 && (
          <ul className="mt-1.5 grid grid-cols-3 gap-2">
            {media.map((m) => (
              <li key={m.mediaId} className="relative aspect-square overflow-hidden rounded-xl bg-soft">
                {m.kind === "video" ? (
                  <video src={m.src} className="size-full object-cover" muted preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.src} alt={m.altText} className="size-full object-cover" />
                )}
                <button
                  type="button"
                  className="icon-btn absolute right-1 top-1 bg-bg/90"
                  aria-label={`Remove ${m.originalName}`}
                  title="Remove"
                  onClick={() => setMedia((all) => all.filter((x) => x.mediaId !== m.mediaId))}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn mt-1.5" onClick={() => picker.current?.click()}>
          <ImagePlus className="size-4" />
          Add a file
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
        {busy && <p className="hint mt-1">{busy}</p>}
        {error && (
          <p role="alert" className="mt-1 text-danger">
            {error}
          </p>
        )}
      </div>

      {groups.length > 0 && (
        <label className="block text-sm font-semibold">
          Column
          <select name="ideaGroupId" className="input mt-1.5" defaultValue={initial?.ideaGroupId ?? ""}>
            <option value="">Unsorted</option>
            {groups.map((g) => (
              <option key={g.ideaGroupId} value={g.ideaGroupId}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="text-sm">
        <legend className="font-semibold">Meant for</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {NETWORK_IDS.map((id) => (
            <label key={id} className="pill-check">
              <input type="checkbox" name="network" value={id} defaultChecked={initial?.networks.includes(id)} />
              {NETWORKS[id].label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-semibold">
        Tags
        <input name="tags" className="input mt-1.5" defaultValue={initial?.tags} aria-describedby="idea-tags-hint" />
        <span id="idea-tags-hint" className="hint mt-1 block font-normal">
          Separate with commas.
        </span>
      </label>
      <label className="block text-sm font-semibold">
        Target date
        <input name="targetAt" type="date" className="input mt-1.5" defaultValue={initial?.targetAt} />
      </label>

      {initial && (
        <Link href="/ideas" className="link-btn block text-sm">
          Cancel editing
        </Link>
      )}
    </ActionForm>
  );
}

/** Move a card to another column. A native select, so it works from the keyboard. */
export function MoveIdea({ ideaId, ideaGroupId, groups }: { ideaId: string; ideaGroupId: string | null; groups: Group[] }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Move to column"
      className="input py-1.5"
      disabled={pending}
      defaultValue={ideaGroupId ?? ""}
      onChange={(e) => {
        const next = e.target.value;
        start(() => moveIdea(ideaId, next));
      }}
    >
      <option value="">Unsorted</option>
      {groups.map((g) => (
        <option key={g.ideaGroupId} value={g.ideaGroupId}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
