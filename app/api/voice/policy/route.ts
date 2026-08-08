import { getVoiceCommunicationPolicy } from "@/lib/voice-policy";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(getVoiceCommunicationPolicy(), {
    headers: { "Cache-Control": "no-store" },
  });
}
