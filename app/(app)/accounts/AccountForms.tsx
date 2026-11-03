"use client";

import { useState, useTransition } from "react";
import { connectWithForm, disconnectAccount, refreshAccount, setAccountActive } from "@/app/actions/accounts";

type Field = { name: string; label: string; type?: string; placeholder?: string; help?: string };

/** Connect networks that use a credential form (Bluesky app password). */
export function FormConnect({ network, fields }: { network: string; fields: Field[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2"
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
        <div key={f.name}>
          <label className="label" htmlFor={`${network}-${f.name}`}>{f.label}</label>
          <input
            id={`${network}-${f.name}`}
            name={f.name}
            type={f.type ?? "text"}
            placeholder={f.placeholder}
            className="input"
            autoComplete="off"
            required={!f.label.includes("optional")}
          />
          {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Connecting…" : "Connect"}</button>
    </form>
  );
}

/** OAuth networks that need input first (Mastodon instance). */
export function OAuthPreForm({ network, fields }: { network: string; fields: Field[] }) {
  return (
    <form method="GET" action={`/api/connect/${network}/start`} className="space-y-2">
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={`${network}-${f.name}`}>{f.label}</label>
          <input id={`${network}-${f.name}`} name={f.name} placeholder={f.placeholder} className="input" required />
        </div>
      ))}
      <button className="btn-primary">Connect</button>
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
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {message && <span className="text-xs text-red-600">{message}</span>}
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await refreshAccount(socialAccountId);
            setMessage(res.error ?? null);
          })
        }
      >
        Refresh
      </button>
      {reconnectHref && <a href={reconnectHref} className="btn">Reconnect</a>}
      <button className="btn" disabled={pending} onClick={() => start(() => setAccountActive(socialAccountId, !isActive))}>
        {isActive ? "Pause" : "Resume"}
      </button>
      <button
        className="btn-danger"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Disconnect this account? Its scheduled posts to this account are removed.")) {
            start(() => disconnectAccount(socialAccountId));
          }
        }}
      >
        Disconnect
      </button>
    </div>
  );
}
