"use client";

import { KeyRound } from "lucide-react";
import { useState, useTransition } from "react";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { passkeyLogin, passkeyLoginOptions } from "@/app/actions/library";
import { assertPasskeys, passkeyError } from "@/components/AddPasskey";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const signIn = () =>
    startTransition(async () => {
      setError("");
      let response: AuthenticationResponseJSON;
      try {
        assertPasskeys();
        const options = await passkeyLoginOptions();
        const cred = (await navigator.credentials.get({
          // Reason: the lib's JSON types differ from the DOM's only in unused extensions.
          publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON),
        })) as PublicKeyCredential;
        response = cred.toJSON();
      } catch (e) {
        return setError(passkeyError(e));
      }
      // Outside the try: on success this redirects, which works by throwing.
      setError((await passkeyLogin(response, next))?.error ?? "");
    });

  return (
    <div className="space-y-4">
      <button type="button" onClick={signIn} className="btn-primary w-full py-2.5" disabled={pending} autoFocus>
        <KeyRound className="size-4" />
        {pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="hint text-center">No passkey on this device? Ask another Posty user for a sign-in link.</p>
    </div>
  );
}
