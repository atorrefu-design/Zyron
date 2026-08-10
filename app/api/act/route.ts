import { NextResponse } from "next/server";
import { decideAction } from "../../../lib/capabilities/action-policy";
import { buildNativeSequence } from "../../../lib/capabilities/compound-native";
import { buildNativePayload } from "../../../lib/capabilities/native-payload";
import { resolveCapabilityRequest } from "../../../lib/capabilities/resolve";

export const runtime = "nodejs";

type ChatMessage = { role: "user" | "assistant"; content: string };
type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

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
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      text?: string;
      deviceLocation?: DeviceLocation | null;
    };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );
    const text = (typeof body.text === "string" ? body.text.trim() : "") || lastUserText(messages);
    if (!text) return NextResponse.json({ error: "Falta la petición" }, { status: 400 });

    const chatPayload = {
      messages: messages.length ? messages : [{ role: "user" as const, content: text }],
      deviceLocation: body.deviceLocation ?? null,
    };

    const sequence = buildNativeSequence(text);
    if (sequence) {
      return NextResponse.json({
        ok: true,
        mode: "native_execute",
        action: "sequence.execute",
        capabilityId: "native.sequence",
        input: text,
        payload: { steps: JSON.stringify(sequence) },
      });
    }

    const resolution = resolveCapabilityRequest(text);
    const decision = decideAction(resolution, text);

    if (decision.kind === "execute" && decision.transport === "native") {
      return NextResponse.json({
        ok: true,
        mode: "native_execute",
        action: decision.target,
        capabilityId: decision.capabilityId,
        input: text,
        payload: buildNativePayload(decision.target, text),
      });
    }

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
      const forwarded = await forward(request, "/api/chat", chatPayload);
      return NextResponse.json(
        { ...forwarded.data, capabilityId: decision.capabilityId },
        { status: forwarded.response.status },
      );
    }

    if (decision.kind === "execute" && decision.transport === "server") {
      if (decision.target === "/api/search/current") {
        const forwarded = await forward(request, decision.target, { query: text });
        return NextResponse.json(
          { ...forwarded.data, capabilityId: decision.capabilityId },
          { status: forwarded.response.status },
        );
      }

      const forwarded = await forward(request, "/api/chat", chatPayload);
      return NextResponse.json(
        { ...forwarded.data, capabilityId: decision.capabilityId },
        { status: forwarded.response.status },
      );
    }

    const forwarded = await forward(request, "/api/chat", chatPayload);
    return NextResponse.json(forwarded.data, { status: forwarded.response.status });
  } catch (error) {
    console.error("ZYRON_ACTION_FIRST_ERROR", error);
    return NextResponse.json({ error: "Error interno al ejecutar la petición" }, { status: 500 });
  }
}
