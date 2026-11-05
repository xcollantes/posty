"use client";

import { LinkIcon, Pause, Play, RefreshCw, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { connectWithForm, disconnectAccount, refreshAccount, setAccountActive } from "@/app/actions/accounts";

type Field = { name: string; label: string; type?: string; placeholder?: string; help?: string };

/** Networks that connect with a credential form (Bluesky app password). */
export function FormConnect({ network, fields }: { network: string; fields: Field[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-2"
        action={(form) =>
          start(async () => {
            setError(null);
            const values = Object.fromEntries(fields.map((f) => [f.name, String(form.get(f.name) ?? "")]));
            const res = await connectWithForm(network, values);
            if (res.error) setError(res.error);
          })
        }
      >
        {fields.map((f) => (
          <label key={f.name} className="text-sm font-semibold">
            {f.label}
            <input
              name={f.name}
              type={f.type ?? "text"}
              placeholder={f.placeholder}
              className="input mt-1.5 w-48"
              autoComplete="off"
              required={!f.label.includes("optional")}
            />
          </label>
        ))}
        <button className="btn" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </button>
      </form>
      {fields
        .filter((f) => f.help)
        .map((f) => (
          <p key={f.name} className="hint mt-1">
            {f.help}
          </p>
        ))}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** OAuth networks that need input first (Mastodon instance). */
export function OAuthPreForm({ network, fields }: { network: string; fields: Field[] }) {
  return (
    <form method="GET" action={`/api/connect/${network}/start`} className="flex flex-wrap items-end gap-2">
      {fields.map((f) => (
        <label key={f.name} className="text-sm font-semibold">
          {f.label}
          <input name={f.name} placeholder={f.placeholder} className="input mt-1.5 w-56" required />
        </label>
      ))}
      <button className="btn">Connect</button>
    </form>
  );
}

export function AccountRowActions({
  socialAccountId,
  isActive,
  reconnectHref,
}: {
  socialAccountId: string;
  isActive: boolean;
  reconnectHref: string | null;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const toggleLabel = isActive ? "Pause" : "Resume";
  return (
    <div>
      <div className="flex gap-0.5">
        <button
          className="icon-btn"
          aria-label="Refresh"
          title="Refresh"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await refreshAccount(socialAccountId);
              setMessage(res.error ?? null);
            })
          }
        >
          <RefreshCw className="size-4" />
        </button>
        {reconnectHref && (
          <a href={reconnectHref} className="icon-btn" aria-label="Reconnect" title="Reconnect">
            <LinkIcon className="size-4" />
          </a>
        )}
        <button
          className="icon-btn"
          aria-label={toggleLabel}
          title={toggleLabel}
          disabled={pending}
          onClick={() => start(() => setAccountActive(socialAccountId, !isActive))}
        >
          {isActive ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button
          className="icon-btn icon-btn-danger"
          aria-label="Disconnect"
          title="Disconnect"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Disconnect this account? Its scheduled posts to this account are removed.")) {
              start(() => disconnectAccount(socialAccountId));
            }
          }}
        >
          <Unplug className="size-4" />
        </button>
      </div>
      {message && <p className="mt-1 max-w-xs text-xs text-danger">{message}</p>}
    </div>
  );
}
