"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { duplicatePost, savePost, type SavePostInput } from "@/app/actions/posts";
import type { PostPart } from "@/lib/db/schema";
import { maxCharsFor, NETWORKS, validatePart, type OptionField } from "@/lib/networks/catalog";
import { extractUrls } from "@/lib/text";
import { PartsEditor, type Counter } from "./PartsEditor";
import { Avatar, Preview } from "./Preview";
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
  hasQueue: boolean;
};

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

export function Composer({ accounts, library, snippets, tags, initial, hasQueue }: Props) {
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
  const [when, setWhen] = useState(toLocalInput(initial.scheduledAt));
  const [tab, setTab] = useState<string>("original");
  const [media, setMedia] = useState<Record<string, ComposerMedia>>(() =>
    Object.fromEntries(library.map((m) => [m.mediaId, m])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedAccounts = selected.map((id) => byId.get(id)!).filter(Boolean);
  const effective = (id: string) => overrides[id] ?? parts;
  const addMedia = (m: ComposerMedia) => setMedia((all) => ({ ...all, [m.mediaId]: m }));

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    if (tab === id) setTab("original");
  };

  const counterFor = (accts: ComposerAccount[]) => (text: string): Counter[] => {
    const seen = new Set<string>();
    return accts.flatMap((a) => {
      const info = NETWORKS[a.network];
      const max = maxCharsFor(a.network, a.meta);
      const key = `${a.network}:${max}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ label: info.label, count: info.count(text, a.meta), max, color: info.color }];
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

  const warnings = [...new Set(selectedAccounts.map((a) => NETWORKS[a.network].warning).filter(Boolean))] as string[];
  const xHasLink = selectedAccounts.some(
    (a) => a.network === "x" && effective(a.socialAccountId).some((p) => extractUrls(p.text).length > 0),
  );
  if (xHasLink) {
    warnings.unshift("This X post contains a link, which costs about $0.20 instead of $0.015.");
  }
  const reconnect = selectedAccounts.filter((a) => a.needsReconnect);

  function submit(mode: SavePostInput["mode"]) {
    setError(null);
    if (mode === "schedule" && !when) {
      setError("Pick a date and time");
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
      scheduledAt: when ? new Date(when).toISOString() : null,
    };
    startTransition(async () => {
      const res = await savePost(input);
      if (!res.ok) setError(res.error);
      else router.push(mode === "draft" ? "/posts?status=drafts" : "/posts?status=scheduled");
    });
  }

  if (readOnly) {
    return (
      <div className="card space-y-3">
        <p>This post already went out, so it can&apos;t be edited.</p>
        <button
          className="btn-primary"
          onClick={() =>
            startTransition(async () => {
              const id = await duplicatePost(initial.postId!);
              if (id) router.push(`/compose/${id}`);
            })
          }
        >
          Duplicate as new draft
        </button>
      </div>
    );
  }

  const tabAccount = tab === "original" ? null : byId.get(tab);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        {/* Account picker */}
        <section aria-label="Accounts" className="flex flex-wrap gap-2">
          {accounts.length === 0 && (
            <p className="text-sm text-muted">
              No accounts yet. <a href="/accounts" className="underline">Connect one</a> to start posting.
            </p>
          )}
          {accounts.map((a) => {
            const on = selected.includes(a.socialAccountId);
            return (
              <button
                key={a.socialAccountId}
                type="button"
                onClick={() => toggle(a.socialAccountId)}
                aria-pressed={on}
                title={`${a.name} (${NETWORKS[a.network].label})`}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition ${on ? "border-accent bg-accent/10" : "border-border opacity-60 hover:opacity-100"}`}
              >
                <Avatar account={a} size={24} />
                <span className="max-w-32 truncate">{a.name}</span>
              </button>
            );
          })}
        </section>

        {/* Tabs: original + per-account customization */}
        {selectedAccounts.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border text-sm">
            {[{ id: "original", label: "Original" }, ...selectedAccounts.map((a) => ({ id: a.socialAccountId, label: `${NETWORKS[a.network].label}: ${a.name}` }))].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-1.5 ${tab === t.id ? "border-accent font-medium" : "border-transparent text-muted"}`}
              >
                {t.label}
                {t.id !== "original" && overrides[t.id] ? " ✎" : ""}
              </button>
            ))}
          </div>
        )}

        {!tabAccount ? (
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
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!overrides[tabAccount.socialAccountId]}
                onChange={(e) =>
                  setOverrides((o) => ({
                    ...o,
                    [tabAccount.socialAccountId]: e.target.checked ? structuredClone(parts) : null,
                  }))
                }
              />
              Customize the text and media for {tabAccount.name}
            </label>
            {overrides[tabAccount.socialAccountId] && (
              <PartsEditor
                parts={overrides[tabAccount.socialAccountId]!}
                update={(fn) =>
                  setOverrides((o) => ({ ...o, [tabAccount.socialAccountId]: fn(o[tabAccount.socialAccountId] ?? parts) }))
                }
                allowThread={NETWORKS[tabAccount.network].threads}
                media={media}
                onMedia={addMedia}
                library={library}
                snippets={snippets}
                counters={counterFor([tabAccount])}
              />
            )}
            <OptionsPanel
              account={tabAccount}
              values={options[tabAccount.socialAccountId] ?? {}}
              onChange={(key, value) =>
                setOptions((o) => ({ ...o, [tabAccount.socialAccountId]: { ...o[tabAccount.socialAccountId], [key]: value } }))
              }
            />
          </div>
        )}

        {/* Network-specific options that must be filled in */}
        {tab === "original" && selectedAccounts.some((a) => NETWORKS[a.network].options.some((f) => f.required)) && (
          <p className="text-xs text-muted">
            Some networks need extra details (board, title…). Open their tab above to fill them in.
          </p>
        )}

        {tags.length > 0 && (
          <section aria-label="Tags" className="flex flex-wrap items-center gap-2">
            <span className="label mb-0">Tags</span>
            {tags.map((t) => {
              const on = tagIds.includes(t.tagId);
              return (
                <button
                  key={t.tagId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTagIds((ids) => (on ? ids.filter((x) => x !== t.tagId) : [...ids, t.tagId]))}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "text-white" : ""}`}
                  style={on ? { background: t.color, borderColor: t.color } : { borderColor: t.color, color: t.color }}
                >
                  {t.name}
                </button>
              );
            })}
          </section>
        )}

        {(warnings.length > 0 || reconnect.length > 0) && (
          <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {reconnect.map((a) => (
              <li key={a.socialAccountId}>⚠ {a.name} needs reconnecting before it can post.</li>
            ))}
            {warnings.map((w) => (
              <li key={w}>ⓘ {w}</li>
            ))}
          </ul>
        )}

        {errors.length > 0 && selected.length > 0 && (
          <ul className="space-y-0.5 text-sm text-red-600" aria-live="polite">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="whitespace-pre-line text-sm text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div>
            <label className="label" htmlFor="when">Date &amp; time</label>
            <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input" />
          </div>
          <button type="button" className="btn" disabled={pending} onClick={() => submit("draft")}>Save draft</button>
          {hasQueue && (
            <button type="button" className="btn" disabled={pending || errors.length > 0} onClick={() => submit("queue")}>
              Add to queue
            </button>
          )}
          <button type="button" className="btn" disabled={pending || errors.length > 0 || !when} onClick={() => submit("schedule")}>
            Schedule
          </button>
          <button type="button" className="btn-primary" disabled={pending || errors.length > 0} onClick={() => submit("now")}>
            {pending ? "Saving…" : "Post now"}
          </button>
        </div>
      </div>

      {/* Previews */}
      <aside className="space-y-3" aria-label="Previews">
        <h2 className="label">Preview</h2>
        {selectedAccounts.length === 0 && <p className="text-sm text-muted">Select an account to see a preview.</p>}
        {selectedAccounts.map((a) => (
          <Preview key={a.socialAccountId} account={a} parts={effective(a.socialAccountId)} media={media} />
        ))}
      </aside>
    </div>
  );
}

function OptionsPanel({
  account,
  values,
  onChange,
}: {
  account: ComposerAccount;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const fields = NETWORKS[account.network].options;
  if (!fields.length) return null;
  return (
    <section className="card space-y-3" aria-label={`${NETWORKS[account.network].label} options`}>
      <h3 className="text-sm font-medium">{NETWORKS[account.network].label} options</h3>
      {fields.map((f) => (
        <OptionInput key={f.key} field={f} account={account} value={values[f.key] ?? ""} onChange={(v) => onChange(f.key, v)} />
      ))}
    </section>
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
    <div>
      <label className="label" htmlFor={id}>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      {field.type === "select" ? (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {!field.default && <option value="">Choose…</option>}
          {choices.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea id={id} className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "checkbox" ? (
        <input id={id} type="checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
      ) : (
        <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <p className="mt-1 text-xs text-muted">{field.help}</p>}
      {field.choicesFromMeta && choices.length === 0 && (
        <p className="mt-1 text-xs text-amber-600">No {field.label.toLowerCase()}s found. Refresh the account on the Accounts page.</p>
      )}
    </div>
  );
}
