"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { saveConnected, toAccount, withFreshToken } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { networks } from "@/lib/networks";
import type { NetworkId } from "@/lib/networks/catalog";

export async function connectWithForm(networkId: string, values: Record<string, string>): Promise<{ error?: string }> {
  await requireUser();
  const network = networks[networkId as NetworkId];
  if (!network || network.connect.kind !== "form") return { error: "Unknown network" };
  try {
    await saveConnected(networkId, await network.connect.verify(values));
    revalidatePath("/accounts");
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function disconnectAccount(socialAccountId: string) {
  await requireUser();
  // Cascades to post_targets; posts already published stay on the network.
  await db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.socialAccountId, socialAccountId));
  revalidatePath("/", "layout");
}

export async function setAccountActive(socialAccountId: string, isActive: boolean) {
  await requireUser();
  await db
    .update(schema.socialAccounts)
    .set({ isActive })
    .where(eq(schema.socialAccounts.socialAccountId, socialAccountId));
  revalidatePath("/", "layout");
}

/** Reload network data (e.g. Pinterest boards) and test the token. */
export async function refreshAccount(socialAccountId: string): Promise<{ error?: string }> {
  await requireUser();
  try {
    const [row] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.socialAccountId, socialAccountId));
    if (!row) return { error: "Account not found" };
    const network = networks[row.network as NetworkId];
    const acct = network.refresh ? await withFreshToken(socialAccountId, true) : toAccount(row);
    if (network.refreshMeta) {
      const meta = await network.refreshMeta(acct);
      await db
        .update(schema.socialAccounts)
        .set({ meta: { ...row.meta, ...meta } })
        .where(eq(schema.socialAccounts.socialAccountId, socialAccountId));
    }
    revalidatePath("/accounts");
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}
