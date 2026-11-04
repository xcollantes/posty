"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { duplicatePost, savePost, type SavePostInput } from "@/app/actions/posts";
import type { PostPart } from "@/lib/db/schema";
import { maxCharsFor, NETWORKS, validatePart, type OptionField } from "@/lib/networks/catalog";
import { extractUrls } from "@/lib/text";
import { PartsEditor, type Counter } from "./PartsEditor";
import { Preview } from "./Preview";
import type {
  ComposerAccount,
  ComposerInitial,
  ComposerMedia,
  ComposerSnippet,
  ComposerTag,
} from "./types";

type Props = {
  accounts: ComposerAccount[];
  library: ComposerMedia[];
  snippets: ComposerSnippet[];
  tags: ComposerTag[];
  initial: ComposerInitial;
  /** Next free queue slot (ISO), or null when the queue has no times. */
  nextSlot: string | null;
  /** The user's timezone, so server and browser format the slot the same way. */
  timezone: string;
};

type When = "queue" | "time" | "now";

/** ISO → value for <input type="datetime-local"> in the browser's timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const defaultOptions = (acct: ComposerAccount) =>
  Object.fromEntries(
    NETWORKS[acct.network].options.filter((f) => f.default).map((f) => [f.key, f.default!]),
  );

export function Composer({ accounts, library, snippets, tags, initial, nextSlot, timezone }: Props) {
  const router = useRouter();
  const byId = useMemo(() => new Map(accounts.map((a) => [a.socialAccountId, a])), [accounts]);
  const readOnly = initial.status === "published" || initial.status === "partial";

  const [selected, setSelected] = useState<string[]>(
    initial.targets.map((t) => t.socialAccountId).filter((id) => byId.has(id)),
  );
  const [parts, setParts] = useState<PostPart[]>(initial.parts.length ? initial.parts : [{ text: "", mediaIds: [] }]);
  const [overrides, setOverrides] = useState<Record<string, PostPart[] | null>>(
    Object.fromEntries(initial.targets.map((t) => [t.socialAccountId, t.override?.parts ?? null])),
  );
  const [options, setOptions] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      accounts.map((a) => [
        a.socialAccountId,
        { ...defaultOptions(a), ...(initial.targets.find((t) => t.socialAccountId === a.socialAccountId)?.options ?? {}) },
      ]),
    ),
  );
  const [tagIds, setTagIds] = useState<string[]>(initial.tagIds);
  const [when, setWhen] = useState<When>(initial.scheduledAt ? "time" : nextSlot ? "queue" : "time");
  const [time, setTime] = useState(toLocalInput(initial.scheduledAt));
  const [media, setMedia] = useState<Record<string, ComposerMedia>>(() =>
    Object.fromEntries(library.map((m) => [m.mediaId, m])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedAccounts = selected.map((id) => byId.get(id)!).filter(Boolean);
  const effective = (id: string) => overrides[id] ?? parts;
  const addMedia = (m: ComposerMedia) => setMedia((all) => ({ ...all, [m.mediaId]: m }));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /** One counter per network (and per limit, e.g. two Mastodon instances). */
  const counterFor = (accts: ComposerAccount[]) => (text: string): Counter[] => {
    const seen = new Set<string>();
    return accts.flatMap((a) => {
      const info = NETWORKS[a.network];
      const max = maxCharsFor(a.network, a.meta);
      const key = `${a.network}:${max}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ label: info.label, count: info.count(text, a.meta), max }];
    });
  };

  const errors = [
    ...new Set(
      selectedAccounts.flatMap((a) => {
        const content = effective(a.socialAccountId);
        return (NETWORKS[a.network].threads ? content : content.slice(0, 1)).flatMap((part) =>
          validatePart(
            a.network,
            { text: part.text, media: part.mediaIds.map((id) => media[id]).filter(Boolean) },
            options[a.socialAccountId] ?? {},
            a.meta,
          ),
        );
      }),
    ),
  ];
  const notes = [...new Set(selectedAccounts.map((a) => NETWORKS[a.network].warning).filter(Boolean))] as string[];
  if (
    selectedAccounts.some(
      (a) => a.network === "x" && effective(a.socialAccountId).some((p) => extractUrls(p.text).length > 0),
    )
  ) {
    notes.unshift("This X post has a link, so it costs about $0.20 instead of $0.015.");
  }
  const reconnect = selectedAccounts.filter((a) => a.needsReconnect);

  function submit(asDraft: boolean) {
    setError(null);
    const mode: SavePostInput["mode"] = asDraft
      ? "draft"
      : when === "queue"
        ? "queue"
        : when === "now"
          ? "now"
          : "schedule";
    if (mode === "schedule" && !time) {
      setError("Pick a date and time.");
      return;
    }
    const input: SavePostInput = {
      postId: initial.postId,
      parts,
      targets: selected.map((id) => ({
        socialAccountId: id,
        override: overrides[id] ? { parts: overrides[id]! } : null,
        options: options[id] ?? {},
      })),
      tagIds,
      mode,
      scheduledAt: when === "time" && time ? new Date(time).toISOString() : null,
    };
    startTransition(async () => {
      const res = await savePost(input);
      if (!res.ok) setError(res.error);
      else router.push(mode === "draft" ? "/posts?status=drafts" : "/posts?status=scheduled");
    });
  }

  if (readOnly) {
    return (
      <div className="max-w-2xl">
        <p>This post has already gone out, so it can&apos;t be edited. You can copy it into a new draft.</p>
        <button
          className="btn-primary mt-3"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const id = await duplicatePost(initial.postId!);
              if (id) router.push(`/compose/${id}`);
            })
          }
        >
          Duplicate as draft
        </button>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {selectedAccounts.map((a) => (
            <Preview key={a.socialAccountId} account={a} parts={effective(a.socialAccountId)} media={media} />
          ))}
        </div>
      </div>
    );
  }

  const goLabel = when === "queue" ? "Add to queue" : when === "now" ? "Post now" : "Schedule";
  const slotLabel = nextSlot
    ? new Intl.DateTimeFormat("en", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(nextSlot))
    : "";

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-8">
        <section>
          <h2 className="mb-2">Post to</h2>
          {accounts.length === 0 ? (
            <p className="text-muted">
              No accounts connected yet. <Link href="/accounts">Connect one</Link> first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              {accounts.map((a) => (
                <label key={a.socialAccountId} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(a.socialAccountId)}
                    onChange={() => toggle(a.socialAccountId)}
                  />
                  {NETWORKS[a.network].label}
                  <span className="text-muted">{a.name}</span>
                  {a.needsReconnect && <span className="text-danger">(reconnect)</span>}
                </label>
              ))}
            </div>
          )}
        </section>

        <PartsEditor
          parts={parts}
          update={(fn) => setParts(fn)}
          allowThread={selectedAccounts.length > 0 && selectedAccounts.every((a) => NETWORKS[a.network].threads)}
          media={media}
          onMedia={addMedia}
          library={library}
          snippets={snippets}
          counters={counterFor(selectedAccounts.filter((a) => !overrides[a.socialAccountId]))}
        />

        {selectedAccounts.length > 0 && (
          <section>
            <h2>Per account</h2>
            <p className="hint mb-2">Change the text for one account, or set its options.</p>
            <div className="border-t border-line">
              {selectedAccounts.map((a) => (
                <AccountPanel
                  key={a.socialAccountId}
                  account={a}
                  custom={!!overrides[a.socialAccountId]}
                  onCustom={(on) =>
                    setOverrides((o) => ({ ...o, [a.socialAccountId]: on ? structuredClone(parts) : null }))
                  }
                  values={options[a.socialAccountId] ?? {}}
                  onOption={(key, value) =>
                    setOptions((o) => ({ ...o, [a.socialAccountId]: { ...o[a.socialAccountId], [key]: value } }))
                  }
                >
                  {overrides[a.socialAccountId] && (
                    <PartsEditor
                      parts={overrides[a.socialAccountId]!}
                      update={(fn) =>
                        setOverrides((o) => ({ ...o, [a.socialAccountId]: fn(o[a.socialAccountId] ?? parts) }))
                      }
                      allowThread={NETWORKS[a.network].threads}
                      media={media}
                      onMedia={addMedia}
                      library={library}
                      snippets={snippets}
                      counters={counterFor([a])}
                    />
                  )}
                </AccountPanel>
              ))}
            </div>
          </section>
        )}

        {tags.length > 0 && (
          <section>
            <h2 className="mb-2">Tags</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              {tags.map((t) => (
                <label key={t.tagId} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={tagIds.includes(t.tagId)}
                    onChange={() =>
                      setTagIds((ids) => (ids.includes(t.tagId) ? ids.filter((x) => x !== t.tagId) : [...ids, t.tagId]))
                    }
                  />
                  <span className="inline-block size-2.5 rounded-[2px]" style={{ background: t.color }} />
                  {t.name}
                </label>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2">When</h2>
          <div className="space-y-2 text-sm">
            {nextSlot && (
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="when" checked={when === "queue"} onChange={() => setWhen("queue")} />
                Next queue slot <span className="text-muted">{slotLabel}</span>
              </label>
            )}
            <label className="flex cursor-pointer flex-wrap items-center gap-2">
              <input type="radio" name="when" checked={when === "time"} onChange={() => setWhen("time")} />
              On
              <input
                type="datetime-local"
                aria-label="Date and time"
                className="input w-auto py-0.5"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setWhen("time");
                }}
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} />
              Now
            </label>
          </div>
        </section>

        {(errors.length > 0 || reconnect.length > 0 || notes.length > 0) && selected.length > 0 && (
          <div className="space-y-1 text-sm" aria-live="polite">
            {errors.map((e) => (
              <p key={e} className="text-danger">
                {e}
              </p>
            ))}
            {reconnect.map((a) => (
              <p key={a.socialAccountId} className="text-danger">
                {a.name} ({NETWORKS[a.network].label}) needs to be reconnected before it can post.
              </p>
            ))}
            {notes.map((n) => (
              <p key={n} className="text-muted">
                {n}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="button"
            className="btn-primary"
            disabled={pending || selected.length === 0 || errors.length > 0}
            onClick={() => submit(false)}
          >
            {pending ? "Saving…" : goLabel}
          </button>
          <button type="button" className="btn" disabled={pending} onClick={() => submit(true)}>
            Save as draft
          </button>
          {error && (
            <p role="alert" className="whitespace-pre-line text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <h2 className="mb-2">Preview</h2>
        {selectedAccounts.length === 0 ? (
          <p className="hint">Pick an account to see the post as it will look there.</p>
        ) : (
          <div className="space-y-4">
            {selectedAccounts.map((a) => (
              <Preview key={a.socialAccountId} account={a} parts={effective(a.socialAccountId)} media={media} />
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function AccountPanel({
  account,
  custom,
  onCustom,
  values,
  onOption,
  children,
}: {
  account: ComposerAccount;
  custom: boolean;
  onCustom: (on: boolean) => void;
  values: Record<string, string>;
  onOption: (key: string, value: string) => void;
  children: React.ReactNode;
}) {
  const info = NETWORKS[account.network];
  const missing = info.options.some((f) => f.required && !values[f.key]?.trim());
  // Open by default when something needs filling in; afterwards only the user toggles it.
  const [open, setOpen] = useState(missing || custom);
  return (
    <details className="border-b border-line py-2" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">
        {info.label} <span className="text-muted">{account.name}</span>
        {custom && <span className="text-muted"> · own text</span>}
        {missing && <span className="text-danger"> · needs details</span>}
      </summary>
      <div className="mb-2 mt-3 space-y-4 pl-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={custom} onChange={(e) => onCustom(e.target.checked)} />
          Use different text and media for this account
        </label>
        {children}
        {info.options.map((f) => (
          <OptionInput key={f.key} field={f} account={account} value={values[f.key] ?? ""} onChange={(v) => onOption(f.key, v)} />
        ))}
      </div>
    </details>
  );
}

function OptionInput({
  field,
  account,
  value,
  onChange,
}: {
  field: OptionField;
  account: ComposerAccount;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `${account.socialAccountId}-${field.key}`;
  const choices = field.choicesFromMeta
    ? ((account.meta[field.choicesFromMeta] as { value: string; label: string }[] | undefined) ?? [])
    : (field.choices ?? []);
  return (
    <div className="max-w-md text-sm">
      <label htmlFor={id} className="mb-1 block">
        {field.label}
        {field.required && <span className="text-muted"> (required)</span>}
      </label>
      {field.type === "select" ? (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {!field.default && <option value="">Choose…</option>}
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea id={id} className="input" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "checkbox" ? (
        <input id={id} type="checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
      ) : (
        <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <p className="hint mt-1">{field.help}</p>}
      {field.choicesFromMeta && choices.length === 0 && (
        <p className="mt-1 text-danger">
          No {field.label.toLowerCase()}s found. Use Refresh on the Accounts page.
        </p>
      )}
    </div>
  );
}
