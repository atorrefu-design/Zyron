import { decideVoiceAction } from "@/lib/voice-orchestrator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      transcript?: string;
      activeConversation?: boolean;
      silenceAfterWakeMs?: number | null;
    };

    return Response.json(decideVoiceAction({
      transcript: body.transcript,
      activeConversation: Boolean(body.activeConversation),
      silenceAfterWakeMs: typeof body.silenceAfterWakeMs === "number" ? body.silenceAfterWakeMs : null,
    }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "voice_decision_invalid_request" }, { status: 400 });
  }
}
