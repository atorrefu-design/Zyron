import { VOICE_ENGAGEMENT } from "@/lib/voice-engagement";
import { getVoiceCommunicationPolicy } from "@/lib/voice-policy";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      communication: getVoiceCommunicationPolicy(),
      engagement: VOICE_ENGAGEMENT,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
