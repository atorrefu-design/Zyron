import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const checks = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    mem0: Boolean(process.env.MEM0_API_KEY),
    ownerKey: Boolean(process.env.ZYRON_OWNER_KEY),
    authSecret: Boolean(process.env.ZYRON_AUTH_SECRET),
  };

  const ok = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      ok,
      service: "zyron-core",
      version: "0.3.0",
      checks,
      time: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
