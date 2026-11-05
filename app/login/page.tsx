import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getUser()) redirect("/calendar");
  const { next } = await searchParams;
  return (
    <main className="hero flex min-h-screen items-center justify-center px-4 py-12 text-white">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="mx-auto size-12" />
          <p className="eyebrow mt-6">Welcome back</p>
          <h1 className="mt-2">Sign in to Posty</h1>
        </div>
        <div className="card p-6">
          <LoginForm next={typeof next === "string" ? next : ""} />
        </div>
      </div>
    </main>
  );
}
