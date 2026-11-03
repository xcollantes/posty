import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getNetwork } from "@/lib/networks";
import { NetworkError } from "@/lib/networks/http";
import type { Account, ConnectedAccount, TokenSet } from "@/lib/networks/types";

type Row = typeof schema.socialAccounts.$inferSelect;

export function toAccount(row: Row): Account {
  return {
    socialAccountId: row.socialAccountId,
    providerAccountId: row.providerAccountId,
    name: row.name,
    username: row.username,
    accessToken: decrypt(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? decrypt(row.refreshTokenEnc) : null,
    expiresAt: row.expiresAt,
    tokenIssuedAt: row.tokenIssuedAt,
    meta: row.meta,
  };
}

/** Download a remote avatar into a small data: URI (remote CDN URLs expire). */
async function avatarDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const webp = await sharp(Buffer.from(await res.arrayBuffer())).resize(96, 96).webp({ quality: 80 }).toBuffer();
    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Insert or update accounts returned by a connect flow. */
export async function saveConnected(network: string, accounts: ConnectedAccount[]) {
  for (const a of accounts) {
    const values = {
      network,
      providerAccountId: a.providerAccountId,
      name: a.name,
      username: a.username ?? null,
      avatar: await avatarDataUri(a.avatarUrl),
      accessTokenEnc: encrypt(a.accessToken),
      refreshTokenEnc: a.refreshToken ? encrypt(a.refreshToken) : null,
      expiresAt: a.expiresAt ?? null,
      tokenIssuedAt: new Date(),
      meta: a.meta ?? {},
      isActive: true,
      needsReconnect: false,
    };
    await db
      .insert(schema.socialAccounts)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.socialAccounts.network, schema.socialAccounts.providerAccountId],
        set: values,
      });
  }
}

async function applyTokens(tx: Pick<typeof db, "update">, row: Row, t: TokenSet) {
  await tx
    .update(schema.socialAccounts)
    .set({
      accessTokenEnc: encrypt(t.accessToken),
      ...(t.refreshToken !== undefined
        ? { refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : null }
        : {}),
      expiresAt: t.expiresAt ?? null,
      tokenIssuedAt: new Date(),
      meta: { ...row.meta, ...(t.meta ?? {}) },
      needsReconnect: false,
    })
    .where(eq(schema.socialAccounts.socialAccountId, row.socialAccountId));
}

export async function markReconnect(socialAccountId: string) {
  await db
    .update(schema.socialAccounts)
    .set({ needsReconnect: true })
    .where(eq(schema.socialAccounts.socialAccountId, socialAccountId));
}

const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * Load an account with a usable access token. Refreshes under a per-account
 * advisory lock and saves rotated refresh tokens in the same transaction, so
 * two workers can never burn the same single-use refresh token.
 */
export async function withFreshToken(socialAccountId: string, force = false): Promise<Account> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${socialAccountId}))`);
      const [row] = await tx
        .select()
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.socialAccountId, socialAccountId));
      if (!row) throw new NetworkError("Account no longer exists");
      const network = getNetwork(row.network);
      const acct = toAccount(row);
      const expiring = acct.expiresAt && acct.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
      if (!network.refresh || !(force || expiring)) {
        if (acct.expiresAt && acct.expiresAt.getTime() < Date.now()) {
          throw new NetworkError(`${network.info.label} token expired; reconnect the account`, null, false, true);
        }
        return acct;
      }
      const tokens = await network.refresh(acct);
      await applyTokens(tx, row, tokens);
      return {
        ...acct,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken === undefined ? acct.refreshToken : tokens.refreshToken,
        expiresAt: tokens.expiresAt ?? null,
        tokenIssuedAt: new Date(),
        meta: { ...acct.meta, ...(tokens.meta ?? {}) },
      };
    });
  } catch (err) {
    if (err instanceof NetworkError && err.reconnect) await markReconnect(socialAccountId);
    throw err;
  }
}
