import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CheckResult = {
  configured: boolean;
  reachable: boolean | null;
  latencyMs: number | null;
  detail?: string;
};

async function timedCheck(check: () => Promise<void>): Promise<Pick<CheckResult, "reachable" | "latencyMs" | "detail">> {
  const startedAt = Date.now();
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4500)),
    ]);
    return { reachable: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message.slice(0, 120) : "unknown_error",
    };
  }
}

async function checkDatabase(): Promise<CheckResult> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return { configured: false, reachable: null, latencyMs: null };

  const result = await timedCheck(async () => {
    const sql = neon(url);
    await sql`SELECT 1 AS ok`;
  });
  return { configured: true, ...result };
}

async function checkMem0(): Promise<CheckResult> {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) return { configured: false, reachable: null, latencyMs: null };

  const result = await timedCheck(async () => {
    const response = await fetch("https://api.mem0.ai/v3/memories/search/", {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "health-check", filters: { user_id: "aaron" }, top_k: 1 }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
  });
  return { configured: true, ...result };
}

export async function GET() {
  const [database, mem0] = await Promise.all([checkDatabase(), checkMem0()]);

  const checks = {
    openai: {
      configured: Boolean(process.env.OPENAI_API_KEY),
      reachable: null,
      latencyMs: null,
    } satisfies CheckResult,
    mem0,
    database,
    ownerKey: {
      configured: Boolean(process.env.ZYRON_OWNER_KEY),
      reachable: null,
      latencyMs: null,
    } satisfies CheckResult,
    authSecret: {
      configured: Boolean(process.env.ZYRON_AUTH_SECRET),
      reachable: null,
      latencyMs: null,
    } satisfies CheckResult,
  };

  const required = [checks.openai, checks.mem0, checks.database, checks.ownerKey, checks.authSecret];
  const configured = required.every((check) => check.configured);
  const reachable = required.every((check) => check.reachable !== false);
  const ok = configured && reachable;

  return NextResponse.json(
    {
      ok,
      service: "zyron-core",
      version: "0.4.0",
      checks,
      time: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
