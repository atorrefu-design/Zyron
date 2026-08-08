import { classifyVoiceEngagement } from "@/lib/voice-engagement";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      transcript?: string;
      activeConversation?: boolean;
      silenceAfterWakeMs?: number | null;
    };

    const result = classifyVoiceEngagement({
      transcript: typeof body.transcript === "string" ? body.transcript : "",
      activeConversation: Boolean(body.activeConversation),
      silenceAfterWakeMs: typeof body.silenceAfterWakeMs === "number"
        ? body.silenceAfterWakeMs
        : null,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { decision: "wait", confidence: 0, reason: "invalid_activation_request" },
      { status: 400 },
    );
  }
}
