import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = new URL("../.github/scripts/ingest.sh", import.meta.url).pathname;
const success = { status: 200, body: { mode: "backfill", done: true, scanned: 1, inserted: 1, updated: 0, unchanged: 0, failed: 0, retrying: 0, errors: [], articles: [{ status: "inserted", title: "Indexed article", url: "https://blog.pulipuli.info/article.html" }] } };
const locked = { status: 409, body: { error: { code: "ingestion_already_running" }, progress: { remainingLockSeconds: 120, lockExpiresAt: "soon", current: null } } };
type Reply = { status: number; body: unknown; headers?: Record<string, string>; exit?: number };

function runClient(replies: Reply[], extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ingest-client-"));
  try {
    writeFileSync(join(dir, "replies.json"), JSON.stringify(replies));
    writeFileSync(join(dir, "count"), "0");
    writeFileSync(join(dir, "requests"), "");
    writeFileSync(join(dir, "sleeps"), "");
    writeFileSync(join(dir, "sleep"), '#!/bin/sh\necho "$1" >> "$FIXTURE_DIR/sleeps"\n', { mode: 0o755 });
    writeFileSync(join(dir, "curl"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const file = name => path.join(process.env.FIXTURE_DIR, name);
const count = Number(fs.readFileSync(file('count'), 'utf8'));
const replies = JSON.parse(fs.readFileSync(file('replies.json'), 'utf8'));
const reply = replies[count];
if (!reply) process.exit(99);
fs.writeFileSync(file('count'), String(count + 1));
const args = process.argv.slice(2);
fs.appendFileSync(file('requests'), args[args.indexOf('-d') + 1] + '\\n');
fs.writeFileSync(args[args.indexOf('--output') + 1], typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
fs.writeFileSync(args[args.indexOf('--dump-header') + 1], Object.entries(reply.headers || {}).map(([key,value]) => key + ': ' + value + '\\r\\n').join(''));
process.stdout.write(String(reply.status).padStart(3, '0'));
process.exit(reply.exit || 0);
`, { mode: 0o755 });
    const result = spawnSync("bash", [script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_DIR: dir, INGEST_URL: "https://worker.example.test/internal/ingest", INGEST_TOKEN: "test-token", INGEST_MAX_ERROR_ATTEMPTS: "2", INGEST_MAX_BATCHES: "2", ...extraEnv },
      encoding: "utf8", timeout: 15_000,
    });
    return { ...result, output: result.stdout + result.stderr, calls: Number(readFileSync(join(dir, "count"), "utf8")), sleeps: readFileSync(join(dir, "sleeps"), "utf8").trim().split("\n"), bodies: readFileSync(join(dir, "requests"), "utf8").trim().split("\n").map((value) => JSON.parse(value)) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("GitHub Actions ingestion client", () => {
  it("preserves the first 503 and survives more lock polls than the error retry budget", () => {
    const result = runClient([
      { status: 503, body: "<html>Error 1102: Worker exceeded resource limits</html>", headers: { "Retry-After": "7", "CF-Ray": "diagnostic-ray" } },
      ...Array.from({ length: 25 }, () => locked), success,
    ]);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toBe(27);
    expect(result.output).toContain("Worker exceeded resource limits");
    expect(result.output).toContain("diagnostic-ray");
    expect(result.output).toContain("phase: unavailable");
    expect(result.output).toContain("Indexed article");
    expect(result.output).toContain("https://blog.pulipuli.info/article.html");
    expect(result.sleeps[0]).toBe("7");
  }, 20_000);

  it("still fails on persistent upstream errors", () => {
    const result = runClient([{ status: 503, body: "First platform error" }, { status: 503, body: "Second platform error" }]);
    expect(result.status).toBe(1);
    expect(result.calls).toBe(2);
    expect(result.output).toContain("failed after 2 upstream error(s)");
  });

  it("bounds lock waiting instead of polling forever", () => {
    const result = runClient([locked], { INGEST_MAX_LOCK_WAIT_SECONDS: "0" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("remained locked");
  });

  it("fails immediately on invalid credentials or malformed success responses", () => {
    expect(runClient([{ status: 401, body: { error: "Unauthorized" } }]).calls).toBe(1);
    const result = runClient([{ status: 200, body: {} }]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("without a valid ingestion result");
  });

  it("resets only the first successful batch and resumes subsequent batches", () => {
    const result = runClient([{ ...success, body: { ...success.body, done: false } }, success], { RESET_BACKFILL: "true" });
    expect(result.status, result.output).toBe(0);
    expect(result.bodies).toEqual([{ reset: true }, {}]);
  });
});
