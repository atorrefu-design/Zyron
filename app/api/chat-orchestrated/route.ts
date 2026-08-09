import { NextRequest, NextResponse } from "next/server";
import { routeCapabilities } from "../../../lib/capabilities/router";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message?.role === "user" && typeof message?.content === "string")?.content?.trim();

    if (!lastUserMessage) {
      return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });
    }

    const routes = routeCapabilities(lastUserMessage);
    const primary = routes[0] ?? null;

    const internalURL = new URL("/api/chat", request.url);
    internalURL.searchParams.set("zyron_internal", "1");

    const forwardedHeaders = new Headers();
    for (const name of ["authorization", "cookie", "content-type", "user-agent"]) {
      const value = request.headers.get(name);
      if (value) forwardedHeaders.set(name, value);
    }
    forwardedHeaders.set("content-type", "application/json");

    const coreResponse = await fetch(internalURL, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await coreResponse.text();
    let payload: Record<string, unknown>;
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      payload = { error: "Respuesta interna de chat no válida." };
    }

    const capability = primary
      ? {
          id: primary.capability.id,
          label: primary.capability.label,
          accessLevel: primary.capability.accessLevel,
          status: primary.capability.status,
          score: primary.score,
          reason: primary.reason,
          fallbackOnly: primary.fallbackOnly,
          fallback: primary.capability.fallback ?? null,
        }
      : null;

    return NextResponse.json(
      {
        ...payload,
        orchestration: {
          primary: capability,
          alternatives: routes.slice(1, 4).map((route) => ({
            id: route.capability.id,
            label: route.capability.label,
            status: route.capability.status,
            score: route.score,
            fallbackOnly: route.fallbackOnly,
          })),
        },
      },
      { status: coreResponse.status },
    );
  } catch (error) {
    console.error("ZYRON_CHAT_ORCHESTRATION_ERROR", error);
    return NextResponse.json({ error: "Error en el orquestador de capacidades de ZYRON" }, { status: 500 });
  }
}
