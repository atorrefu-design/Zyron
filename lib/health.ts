import { neon } from "@neondatabase/serverless";
import { getMemoryStats } from "./memory";

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
      detail: error instanceof Error ? error.message.slice(0, 160) : "unknown_error",
    };
  }
}

async function checkOpenAI(): Promise<CheckResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { configured: false, reachable: null, latencyMs: null };

  const result = await timedCheck(async () => {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("openai_key_rejected");
      if (response.status === 403) throw new Error("openai_key_forbidden");
      throw new Error(`openai_http_${response.status}`);
    }
  }, 8000);

  return { configured: true, ...result };
}

async function checkAIGateway(): Promise<CheckResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return { configured: false, reachable: null, latencyMs: null };

  const result = await timedCheck(async () => {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("ai_gateway_key_rejected");
      if (response.status === 403) throw new Error("ai_gateway_key_forbidden");
      throw new Error(`ai_gateway_http_${response.status}`);
    }
  }, 8000);

  return { configured: true, ...result };
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

async function checkMemory(): Promise<CheckResult> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return { configured: false, reachable: null, latencyMs: null };
  const startedAt = Date.now();
  try {
    const stats = await getMemoryStats();
    return {
      configured: true,
      reachable: true,
      latencyMs: Date.now() - startedAt,
      detail: `${stats.blocks} bloques activos`,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message.slice(0, 160) : "memory_error",
    };
  }
}

export async function getZyronHealth(): Promise<ZyronHealth> {
  const [openai, aiGateway, database, memory] = await Promise.all([
    checkOpenAI(),
    checkAIGateway(),
    checkDatabase(),
    checkMemory(),
  ]);
  const checks = {
    openai,
    aiGateway,
    database,
    memory,
    maps: { configured: Boolean(process.env.GOOGLE_MAPS_API_KEY), reachable: null, latencyMs: null },
    ownerKey: { configured: Boolean(process.env.ZYRON_OWNER_KEY), reachable: null, latencyMs: null },
    authSecret: { configured: Boolean(process.env.ZYRON_AUTH_SECRET), reachable: null, latencyMs: null },
  } satisfies Record<string, CheckResult>;

  const required = [checks.openai, checks.database, checks.memory, checks.ownerKey, checks.authSecret];
  const ok = required.every((check) => check.configured && check.reachable !== false);
  return { ok, service: "zyron-core", version: "0.21.0", checks, time: new Date().toISOString() };
}
