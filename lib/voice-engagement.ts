export type VoiceEngagementDecision = "activate" | "ignore" | "wait" | "continue" | "end";

export const VOICE_ENGAGEMENT = {
  wakeWord: "ZYRON",
  wakeConfirmationWindowMs: 1800,
  wakePauseActivationMs: 250,
  idleConversationTimeoutMs: 45000,
  softGoodbyeTimeoutMs: 5000,
  localContextWindowMs: 4000,
} as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyVoiceEngagement(options: {
  transcript?: string;
  activeConversation?: boolean;
  silenceAfterWakeMs?: number | null;
}) {
  const transcript = normalize(options.transcript ?? "");

  if (options.activeConversation) {
    if (/^(?:zyron )?(?:termina|para|cierra la conversacion|hasta luego|puedes descansar)(?: zyron)?$/.test(transcript)) {
      return { decision: "end" as const, confidence: 0.99, reason: "explicit_end" };
    }
    if (/^(?:gracias|gracias zyron|vale gracias|perfecto gracias|ya esta|eso es todo)$/.test(transcript)) {
      return { decision: "end" as const, confidence: 0.82, reason: "soft_end" };
    }
    return { decision: "continue" as const, confidence: 0.99, reason: "already_active" };
  }

  if (!transcript) return { decision: "wait" as const, confidence: 0.99, reason: "no_context" };

  const wakeIndex = transcript.lastIndexOf("zyron");
  if (wakeIndex < 0) return { decision: "ignore" as const, confidence: 0.99, reason: "wake_absent" };

  const before = transcript.slice(0, wakeIndex).trim();
  const after = transcript.slice(wakeIndex + 5).trim();
  const directAtStart = /^(?:oye |eh |hola |vamos |por favor )?zyron\b/.test(transcript);
  const mentionBefore = /(?:hablando de|hablar de|sobre|acerca de|se llama|llamado|el nombre|la palabra|el proyecto|la app|la aplicacion|el asistente|dije|he dicho|decir|dices)\s+(?:a\s+)?$/.test(before);
  const mentionAfter = /^(?:es\b|se llama\b|significa\b|como nombre\b|como app\b|como asistente\b|fue\b|era\b)/.test(after);

  if ((mentionBefore || mentionAfter) && !directAtStart) {
    return { decision: "ignore" as const, confidence: 0.94, reason: "name_mentioned" };
  }

  if (directAtStart && after) {
    return { decision: "activate" as const, confidence: 0.99, reason: "direct_call_with_request", command: after };
  }

  if (/^(?:oye |eh |hola )?zyron$/.test(transcript)) {
    const pause = options.silenceAfterWakeMs ?? 0;
    return pause >= VOICE_ENGAGEMENT.wakePauseActivationMs
      ? { decision: "activate" as const, confidence: 0.97, reason: "direct_call_with_pause", command: "" }
      : { decision: "wait" as const, confidence: 0.9, reason: "waiting_for_followup" };
  }

  if (!before && after) {
    return { decision: "activate" as const, confidence: 0.96, reason: "wake_leads_utterance", command: after };
  }

  return { decision: "ignore" as const, confidence: 0.78, reason: "embedded_name" };
}
