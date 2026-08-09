import { NextResponse } from "next/server";
import { decideAction } from "../../../lib/capabilities/action-policy";
import { resolveCapabilityRequest } from "../../../lib/capabilities/resolve";

export const runtime = "nodejs";

type ChatMessage = { role: "user" | "assistant"; content: string };

function lastUserText(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content?.trim() || "";
}

async function forward(request: Request, path: string, body: unknown) {
  const target = new URL(path, request.url);
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);

  const response = await fetch(target, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({ error: "Respuesta no válida del ejecutor" }));
  return { response, data };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[]; text?: string };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );
    const text = (typeof body.text === "string" ? body.text.trim() : "") || lastUserText(messages);
    if (!text) return NextResponse.json({ error: "Falta la petición" }, { status: 400 });

    const resolution = resolveCapabilityRequest(text);
    const decision = decideAction(resolution);

    // Native actions are commands for the iPhone companion. They are not exposed as
    // "plans" to the conversational UI: the client should execute them immediately.
    if (decision.kind === "execute" && decision.transport === "native") {
      return NextResponse.json({
        ok: true,
        mode: "native_execute",
        action: decision.target,
        capabilityId: decision.capabilityId,
        input: text,
      });
    }

    // Destructive/sensitive actions stop here until the user confirms.
    if (decision.kind === "confirm") {
      return NextResponse.json({
        ok: false,
        mode: "confirmation_required",
        capabilityId: decision.capabilityId,
        transport: decision.transport,
        target: decision.target,
        input: text,
      });
    }

    if (decision.kind === "request_access") {
      return NextResponse.json({
        ok: false,
        mode: "access_required",
        capabilityId: decision.capabilityId,
        action: decision.action,
        message: decision.message,
        input: text,
      });
    }

    if (decision.kind === "fallback") {
      // Do not dead-end the user if ZYRON can still reason or search through chat.
      const forwarded = await forward(request, "/api/chat", {
        messages: messages.length ? messages : [{ role: "user", content: text }],
      });
      return NextResponse.json({ ...forwarded.data, capabilityId: decision.capabilityId }, { status: forwarded.response.status });
    }

    if (decision.kind === "execute" && decision.transport === "server") {
      // Current-info is a generic query executor. Existing domain actions (calendar,
      // tasks, Gmail, etc.) already execute inside /api/chat; route them there until
      // their handlers are extracted behind the same executor interface.
      if (decision.target === "/api/search/current") {
        const forwarded = await forward(request, decision.target, { query: text });
        return NextResponse.json({ ...forwarded.data, capabilityId: decision.capabilityId }, { status: forwarded.response.status });
      }

      const forwarded = await forward(request, "/api/chat", {
        messages: messages.length ? messages : [{ role: "user", content: text }],
      });
      return NextResponse.json({ ...forwarded.data, capabilityId: decision.capabilityId }, { status: forwarded.response.status });
    }

    // Pure conversation remains conversation, but still uses the same single entrypoint.
    const forwarded = await forward(request, "/api/chat", {
      messages: messages.length ? messages : [{ role: "user", content: text }],
    });
    return NextResponse.json(forwarded.data, { status: forwarded.response.status });
  } catch (error) {
    console.error("ZYRON_ACTION_FIRST_ERROR", error);
    return NextResponse.json({ error: "Error interno al ejecutar la petición" }, { status: 500 });
  }
}
