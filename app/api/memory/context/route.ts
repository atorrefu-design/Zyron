import { NextRequest, NextResponse } from "next/server";
import { buildMemoryContext } from "../../../../lib/memory";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { query?: string; maxCharacters?: number };
    const query = body.query?.trim() || "";
    if (!query) return NextResponse.json({ error: "Falta la consulta" }, { status: 400 });
    const maxCharacters = Math.max(2_000, Math.min(Number(body.maxCharacters) || 20_000, 50_000));
    const result = await buildMemoryContext(query, maxCharacters);
    return NextResponse.json({
      ok: true,
      query,
      context: result.context,
      blocksUsed: result.blocks.map((block) => ({
        id: block.id,
        heading: block.heading,
        sectionPath: block.section_path,
        score: block.score,
      })),
    });
  } catch (error) {
    console.error("ZYRON_MEMORY_CONTEXT_ERROR", error);
    return NextResponse.json({ error: "No se ha podido construir el contexto" }, { status: 500 });
  }
}
