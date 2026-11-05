import { createMcpHandler } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { bearerOk } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { buildServer } from "@/lib/mcp";

/**
 * MCP endpoint (streamable HTTP, stateless) for LLM clients such as
 * Claude Code. Callers send `Authorization: Bearer $MCP_TOKEN` and act as
 * the ADMIN_EMAIL user. With MCP_TOKEN unset the endpoint doesn't exist.
 */
async function handle(request: Request): Promise<Response> {
  const token = process.env.MCP_TOKEN;
  if (!token) return new Response("Not found", { status: 404 });
  if (!bearerOk(request.headers.get("authorization"), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = process.env.ADMIN_EMAIL ?? "";
  const [user] = await db
    .select({
      userId: schema.users.userId,
      email: schema.users.email,
      name: schema.users.name,
      timezone: schema.users.timezone,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (!user) return Response.json({ error: `No user with ADMIN_EMAIL "${email}"` }, { status: 500 });
  return createMcpHandler(() => buildServer(user)).fetch(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
