import { classifyVoiceEngagement } from "@/lib/voice-engagement";
import { getVoiceCommunicationPolicy } from "@/lib/voice-policy";

export type VoiceOrchestratorInput = {
  transcript?: string;
  activeConversation?: boolean;
  silenceAfterWakeMs?: number | null;
  now?: Date;
};

export function decideVoiceAction(input: VoiceOrchestratorInput) {
  const communication = getVoiceCommunicationPolicy(input.now ?? new Date());
  const engagement = classifyVoiceEngagement({
    transcript: input.transcript,
    activeConversation: input.activeConversation,
    silenceAfterWakeMs: input.silenceAfterWakeMs,
  });

  const shouldOpenRealtime = engagement.decision === "activate";
  const shouldKeepRealtime = engagement.decision === "continue";
  const shouldCloseRealtime = engagement.decision === "end";
  const shouldIgnore = engagement.decision === "ignore";
  const shouldWait = engagement.decision === "wait";

  return {
    engagement,
    communication,
    action: {
      shouldOpenRealtime,
      shouldKeepRealtime,
      shouldCloseRealtime,
      shouldIgnore,
      shouldWait,
      responseMode: communication.responseMode,
      shouldSpeak: communication.shouldSpeak,
      deliverTextSilently: communication.responseMode === "text",
    },
  };
}
