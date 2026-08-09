import { NextResponse } from "next/server";
import { resolveCapabilityRequest } from "../../../../lib/capabilities/resolve";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input?: string };
    const input = body.input?.trim() ?? "";
    if (!input) {
      return NextResponse.json({ error: "Falta la petición del usuario." }, { status: 400 });
    }

    const resolution = resolveCapabilityRequest(input);
    return NextResponse.json(
      {
        ok: true,
        input,
        resolution,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_CAPABILITY_RESOLVE_ERROR", error);
    return NextResponse.json({ error: "No he podido resolver la capacidad." }, { status: 500 });
  }
}
