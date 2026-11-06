import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  // Reason: the database tests share one Postgres and rewrite each other's posts.
  test: { environment: "node", include: ["tests/**/*.test.ts"], fileParallelism: false },
});
