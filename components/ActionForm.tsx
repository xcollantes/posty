"use client";

import { useActionState } from "react";

type State = { error?: string; ok?: string } | undefined;

/** A <form> bound to a server action that returns {error|ok}. */
export function ActionForm({
  action,
  children,
  className,
  submitLabel = "Save",
}: {
  action: (prev: State, form: FormData) => Promise<State>;
  children: React.ReactNode;
  className?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {children}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        {state?.error && <span role="alert" className="text-sm text-red-600">{state.error}</span>}
        {state?.ok && <span className="text-sm text-green-600">{state.ok}</span>}
      </div>
    </form>
  );
}

/** A one-button form for a bound server action (delete, etc.). */
export function ActionButton({
  action,
  label,
  confirm,
  className = "btn-danger",
}: {
  action: () => Promise<unknown>;
  label: string;
  confirm?: string;
  className?: string;
}) {
  return (
    <form
      action={async () => {
        await action();
      }}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button className={className}>{label}</button>
    </form>
  );
}
