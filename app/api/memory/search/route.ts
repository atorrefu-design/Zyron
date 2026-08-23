import { NextRequest, NextResponse } from "next/server";
import { searchMemoryBlocks } from "../../../../lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (!query) return NextResponse.json({ error: "Falta el parámetro q" }, { status: 400 });
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 8);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 8;
    const blocks = await searchMemoryBlocks(query, { limit, includeAlways: false });
    return NextResponse.json({ ok: true, query, count: blocks.length, blocks }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("ZYRON_MEMORY_SEARCH_ERROR", error);
    return NextResponse.json({ error: "No se ha podido buscar en la memoria" }, { status: 500 });
  }
}
