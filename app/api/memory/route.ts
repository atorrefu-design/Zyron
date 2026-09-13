import { NextRequest, NextResponse } from "next/server";
import {
  deleteMemoryBlock,
  updateMemoryContent,
  getMemoryStats,
  listMemoryDocuments,
  recordManualMemoryFact,
} from "../../../lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, documents] = await Promise.all([getMemoryStats(), listMemoryDocuments()]);
    return NextResponse.json({ ok: true, stats, documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_MEMORY_STATUS_ERROR", error);
    return NextResponse.json({ error: "No se ha podido consultar la memoria de ZYRON" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      content?: string;
      heading?: string;
      source?: string;
    };
    const content = body.content?.trim() || "";
    if (!content) return NextResponse.json({ error: "Falta el contenido de la memoria" }, { status: 400 });
    const block = await recordManualMemoryFact(content, {
      heading: body.heading?.trim() || undefined,
      source: body.source?.trim() || "memory-api",
    });
    return NextResponse.json({ ok: true, block }, { status: 201 });
  } catch (error) {
    console.error("ZYRON_MEMORY_CREATE_ERROR", error);
    const message = error instanceof Error ? error.message : "No se ha podido guardar la memoria";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")?.trim() || "";
    if (!id) return NextResponse.json({ error: "Falta el identificador del bloque" }, { status: 400 });
    const deleted = await deleteMemoryBlock(id);
    return NextResponse.json({ ok: true, deleted }, { status: deleted ? 200 : 404 });
  } catch (error) {
    console.error("ZYRON_MEMORY_DELETE_ERROR", error);
    return NextResponse.json({ error: "No se ha podido eliminar el bloque de memoria" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || typeof body.content !== "string" || typeof body.expectedContent !== "string") {
      return NextResponse.json({ error: "Faltan identificador, contenido y versión anterior." }, { status: 400 });
    }
    if (!body.content.trim() || body.content.length > 8000) return NextResponse.json({ error: "Contenido vacío o demasiado largo." }, { status: 400 });
    const block = await updateMemoryContent(body.id, body.expectedContent, body.content);
    if (!block) return NextResponse.json({ error: "El recuerdo ha cambiado o ya no existe. Vuelva a buscarlo antes de editar." }, { status: 409 });
    return NextResponse.json({ ok: true, block });
  } catch {
    return NextResponse.json({ error: "No se ha podido modificar la memoria." }, { status: 500 });
  }
}
