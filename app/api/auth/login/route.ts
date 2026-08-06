import { NextRequest, NextResponse } from "next/server";
import { createOwnerSession, ownerKeyMatches } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { key?: string };
    const allowed = await ownerKeyMatches(body.key ?? "");

    if (!allowed) {
      return NextResponse.json({ error: "Clave incorrecta" }, { status: 401 });
    }

    const token = await createOwnerSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set("zyron_owner_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Owner login failed", error);
    return NextResponse.json({ error: "No se pudo iniciar sesión" }, { status: 500 });
  }
}
