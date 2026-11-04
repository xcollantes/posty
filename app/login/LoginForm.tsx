"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/library";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus className="input mt-1" />
      </label>
      <label className="block text-sm">
        Password
        <input name="password" type="password" autoComplete="current-password" required className="input mt-1" />
      </label>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
