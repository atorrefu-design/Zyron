import { neon } from "@neondatabase/serverless";

export type CheckResult = {
  configured: boolean;
  reachable: boolean | null;
  latencyMs: number | null;
  detail?: string;
};

export type ZyronHealth = {
  ok: boolean;
  service: "zyron-core";
  version: string;
  checks: Record<string, CheckResult>;
  time: string;
};

async function timedCheck(check: () => Promise<void>, timeoutMs = 4500): Promise<Pick<CheckResult, "reachable" | "latencyMs" | "detail">> {
  const startedAt = Date.now();
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
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

  // A health check should only verify that Mem0 is reachable and the API key is valid.
  // Semantic search can invoke embedding/retrieval work and occasionally exceed a short
  // health-check timeout even while the service itself is healthy, so use the lightweight
  // paginated memory-list endpoint instead.
  const result = await timedCheck(async () => {
    const response = await fetch("https://api.mem0.ai/v3/memories/?page=1&page_size=1", {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { user_id: "aaron" } }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`http_${response.status}${detail ? `:${detail.slice(0, 80)}` : ""}`);
    }
  }, 8000);

  return { configured: true, ...result };
}

export async function getZyronHealth(): Promise<ZyronHealth> {
  const [database, mem0] = await Promise.all([checkDatabase(), checkMem0()]);
  const checks = {
    openai: { configured: Boolean(process.env.OPENAI_API_KEY), reachable: null, latencyMs: null },
    mem0,
    database,
    ownerKey: { configured: Boolean(process.env.ZYRON_OWNER_KEY), reachable: null, latencyMs: null },
    authSecret: { configured: Boolean(process.env.ZYRON_AUTH_SECRET), reachable: null, latencyMs: null },
  } satisfies Record<string, CheckResult>;

  const required = Object.values(checks);
  const ok = required.every((check) => check.configured && check.reachable !== false);
  return { ok, service: "zyron-core", version: "0.4.2", checks, time: new Date().toISOString() };
}
