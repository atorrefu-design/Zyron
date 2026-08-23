import { NextRequest, NextResponse } from "next/server";
import { importMemoryDocument } from "../../../../lib/memory";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      documentId?: string;
      title?: string;
      version?: string;
      markdown?: string;
      sourceType?: string;
      metadata?: Record<string, unknown>;
    };
    if (typeof body.markdown !== "string" || !body.markdown.trim()) {
      return NextResponse.json({ error: "Falta el documento Markdown" }, { status: 400 });
    }
    const result = await importMemoryDocument({
      documentId: body.documentId,
      title: body.title,
      version: body.version,
      markdown: body.markdown,
      sourceType: body.sourceType,
      metadata: body.metadata,
    });
    return NextResponse.json({ ok: true, result }, { status: result.unchanged ? 200 : 201 });
  } catch (error) {
    console.error("ZYRON_MEMORY_IMPORT_ERROR", error);
    const message = error instanceof Error ? error.message : "No se ha podido importar la memoria";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
