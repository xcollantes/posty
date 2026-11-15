"use client";

import { KeyRound } from "lucide-react";
import { useState, useTransition } from "react";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { passkeyRegister, passkeyRegisterOptions } from "@/app/actions/library";

type Message = { error?: string; ok?: string };

/** The JSON helpers shipped in Chrome 129, Firefox 119 and Safari 18.4. */
export function assertPasskeys() {
  if (typeof PublicKeyCredential === "undefined" || !("parseCreationOptionsFromJSON" in PublicKeyCredential)) {
    throw new Error("This browser doesn't support passkeys. Update it or try another one.");
  }
}

/** A readable message for a failed navigator.credentials call. */
export function passkeyError(e: unknown): string {
  if (e instanceof DOMException && e.name === "NotAllowedError") return "Cancelled, or the passkey prompt timed out.";
  if (e instanceof DOMException && e.name === "InvalidStateError") {
    return "This device already has a Posty passkey for this account.";
  }
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

/** Creates a passkey for the signed-in user, or for a sign-in link's user. */
export function AddPasskey({ token, label = "Add a passkey" }: { token?: string; label?: string }) {
  const [message, setMessage] = useState<Message>({});
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      setMessage({});
      let response: RegistrationResponseJSON;
      try {
        assertPasskeys();
        const { options, error } = await passkeyRegisterOptions(token);
        if (!options) return setMessage({ error });
        const cred = (await navigator.credentials.create({
          // Reason: the lib's JSON types differ from the DOM's only in unused extensions.
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options as PublicKeyCredentialCreationOptionsJSON),
        })) as PublicKeyCredential;
        response = cred.toJSON();
      } catch (e) {
        return setMessage({ error: passkeyError(e) });
      }
      // Outside the try: with a link, this redirects, which works by throwing.
      setMessage((await passkeyRegister(response, token)) ?? {});
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={add} className="btn-primary" disabled={pending}>
        <KeyRound className="size-4" />
        {pending ? "Waiting for your passkey…" : label}
      </button>
      {message.error && <span role="alert" className="text-sm text-danger">{message.error}</span>}
      {message.ok && <span className="text-sm text-ok">{message.ok}</span>}
    </div>
  );
}
