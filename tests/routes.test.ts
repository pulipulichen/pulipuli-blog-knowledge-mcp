import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function mockEnv(): Env {
  const db = {
    prepare(sql: string) {
      const first = vi.fn(async () => sql.includes("SELECT 1 AS ok") ? { ok: 1 } : null);
      return {
        first,
        bind: () => ({
          first,
          all: vi.fn(async () => ({ results: [] })),
        }),
      };
    },
  };
  return {
    DB: db,
    BLOG_FEED_URL: "https://blog.pulipuli.info/feeds/posts/default",
    BLOG_BASE_URL: "https://blog.pulipuli.info/",
    INGEST_TOKEN: "unit-test-token",
    AI: { run: vi.fn() },
  } as unknown as Env;
}

describe("public Worker routes (without Cloudflare credentials)", () => {
  it("serves a search page with a content security policy", async () => {
    const response = await worker.fetch(new Request("https://worker.example.test/"), mockEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("reports D1 health", async () => {
    const response = await worker.fetch(new Request("https://worker.example.test/health"), mockEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok", database: "ok", mcp: "/mcp",
    });
  });

  it("rejects bad search input with a 400 error", async () => {
    const response = await worker.fetch(new Request("https://worker.example.test/api/search?q=a"), mockEnv());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "query_too_short" },
    });
  });

  it("performs a keyword search without external network calls", async () => {
    const response = await worker.fetch(new Request(
      "https://worker.example.test/api/search?q=MCP&mode=keyword",
    ), mockEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ count: 0, mode: "keyword" });
  });

  it("does not permit ingestion with a missing or invalid bearer token", async () => {
    const url = "https://worker.example.test/internal/ingest";
    for (const authorization of [undefined, "Bearer wrong-token"]) {
      const response = await worker.fetch(new Request(url, {
        method: "POST",
        ...(authorization ? { headers: { authorization } } : {}),
        body: "{}",
      }), mockEnv());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "unauthorized" },
      });
    }
  });

  it("returns Retry-After on an ingestion lock conflict", async () => {
    const env = mockEnv();
    env.DB = {
      prepare(sql: string) {
        if (sql.includes("INSERT OR IGNORE INTO sync_lock")) {
          return { run: async () => ({ success: true }) };
        }
        if (sql.includes("UPDATE sync_lock SET token")) {
          return { bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as D1Database;

    const response = await worker.fetch(new Request(
      "https://worker.example.test/internal/ingest",
      { method: "POST", headers: { authorization: "Bearer unit-test-token" }, body: "{}" },
    ), env);
    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("20");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ingestion_already_running" },
    });
  });

  it("responds to CORS preflight without credentials", async () => {
    const response = await worker.fetch(new Request("https://worker.example.test/mcp", {
      method: "OPTIONS",
    }), mockEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toContain("Mcp-Protocol-Version");
  });

  it("returns a not-found response for unindexed article IDs", async () => {
    const response = await worker.fetch(new Request(
      "https://worker.example.test/api/articles/missing",
    ), mockEnv());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "article_not_found" },
    });
  });
});
