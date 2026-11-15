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
  children?: React.ReactNode;
  className?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {state?.error && <span role="alert" className="text-sm text-danger">{state.error}</span>}
        {/* break-all: the ok message can carry a long sign-in link. */}
        {state?.ok && <span className="text-sm break-all text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}

/** A small button for a bound server action (delete, remove…). */
export function ActionButton({
  action,
  label,
  title,
  confirm,
  className = "danger-btn text-sm",
}: {
  action: () => Promise<unknown>;
  label: React.ReactNode;
  /** Tooltip and accessible name; required when the label is only an icon. */
  title?: string;
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
      <button className={className} title={title} aria-label={title}>
        {label}
      </button>
    </form>
  );
}
