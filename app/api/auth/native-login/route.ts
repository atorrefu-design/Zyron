import { NextRequest } from "next/server";
import { createOwnerSession, ownerKeyMatches } from "../../../../lib/auth";

export const runtime = "nodejs";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { key?: string };
    const allowed = await ownerKeyMatches(body.key ?? "");

    if (!allowed) {
      return Response.json({ error: "Clave incorrecta" }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const token = await createOwnerSession(SESSION_TTL_SECONDS);
    return Response.json({
      ok: true,
      token,
      tokenType: "Bearer",
      expiresIn: SESSION_TTL_SECONDS,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Native owner login failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "No se pudo iniciar sesión" }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
