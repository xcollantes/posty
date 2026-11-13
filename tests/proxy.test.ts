import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const run = (path: string, funnel = true) =>
  proxy(new NextRequest(`http://localhost${path}`, {
    headers: funnel ? { "tailscale-funnel-request": "?1" } : {},
  }));

describe("proxy over Tailscale Funnel", () => {
  it.each(["/api/mcp", "/media/abc.jpg"])("lets %s through", (path) => {
    expect(run(path).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/", "/login", "/api/health", "/api/mcpx", "/api/mcp/x"])("hides %s", (path) => {
    expect(run(path).status).toBe(404);
  });

  it("still sends tailnet visitors without a session to /login", () => {
    expect(run("/", false).headers.get("location")).toContain("/login");
  });
});
