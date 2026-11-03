import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getUser()) redirect("/calendar");
  const { next } = await searchParams;
  return (
    <main className="mx-auto max-w-xs px-4 pt-[16vh]">
      <h1 className="mb-6">Posty</h1>
      <LoginForm next={typeof next === "string" ? next : ""} />
    </main>
  );
}
