import { NextResponse } from "next/server";
import { exportMemorySnapshot } from "../../../../lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await exportMemorySnapshot();
    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="zyron-memory-${date}.json"`,
      },
    });
  } catch (error) {
    console.error("ZYRON_MEMORY_EXPORT_ERROR", error);
    return NextResponse.json({ error: "No se ha podido exportar la memoria" }, { status: 500 });
  }
}
