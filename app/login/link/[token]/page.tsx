import type { Metadata } from "next";
import { AddPasskey } from "@/components/AddPasskey";
import { Logo } from "@/components/ui";
import { findSignInLink } from "@/lib/passkeys";

export const metadata: Metadata = { title: "Create a passkey", referrer: "no-referrer" };

/** Opening the link only reads it; creating the passkey uses it up. */
export default async function SignInLinkPage({ params }: PageProps<"/login/link/[token]">) {
  const { token } = await params;
  const user = await findSignInLink(token);
  return (
    <main className="hero flex min-h-screen items-center justify-center px-4 py-12 text-white">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="mx-auto size-12" />
          <h1 className="mt-6">{user ? "Create a passkey" : "Link expired"}</h1>
        </div>
        <div className="card space-y-4 p-6">
          {user ? (
            <>
              <p className="text-sm">
                Posty signs you in with a passkey instead of a password. Create one for{" "}
                <strong>{user.email}</strong> on this device.
              </p>
              <AddPasskey token={token} label="Create my passkey" />
            </>
          ) : (
            <p className="text-sm">
              This link expired or was already used. Ask another Posty user for a new one.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
