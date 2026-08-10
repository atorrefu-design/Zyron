export type NativePayload = Record<string, string>;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function stripWakeWord(value: string) {
  return value.replace(/^\s*(zyron|zayron)[,\s:-]*/i, "").trim();
}

function extractDestination(input: string): string | undefined {
  const clean = stripWakeWord(input);
  const patterns = [
    /(?:llevame|llévame|navega|vamos|ve|ir)\s+(?:a|al|hasta)\s+(.+)$/i,
    /(?:ruta|como llego|cómo llego)\s+(?:a|al|hasta)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim().replace(/[.!?]+$/, "");
  }
  return undefined;
}

function extractReminder(input: string): NativePayload {
  const clean = stripWakeWord(input);
  const normalized = normalize(clean);
  const payload: NativePayload = {};

  const relative = normalized.match(/(?:en|dentro de)\s+(\d+)\s*(minuto|minutos|hora|horas)/);
  if (relative) {
    const amount = Number(relative[1]);
    const seconds = relative[2].startsWith("hora") ? amount * 3600 : amount * 60;
    payload.afterSeconds = String(seconds);
  }

  const quoted = clean.match(/[“"]([^”"]+)[”"]/);
  if (quoted?.[1]) payload.body = quoted[1].trim();

  if (!payload.body) {
    const body = clean
      .replace(/^(av[ií]same|recu[eé]rdame|notif[ií]came)\s*/i, "")
      .replace(/(?:en|dentro de)\s+\d+\s*(?:minuto|minutos|hora|horas)/i, "")
      .trim()
      .replace(/^[,:-]+|[.!?]+$/g, "")
      .trim();
    if (body) payload.body = body;
  }

  payload.title = "ZYRON";
  return payload;
}

function extractWhatsAppTarget(input: string): NativePayload {
  const clean = stripWakeWord(input);
  const match = clean.match(/(?:whatsapp|whatsap|watsap)(?:\s+(?:a|con|de))?\s+(.+)$/i);
  if (!match?.[1]) return {};
  const target = match[1]
    .replace(/^(abre|abrir|escribe|mensaje|chat)\s+/i, "")
    .trim()
    .replace(/[.!?]+$/, "");
  return target ? { target } : {};
}

export function buildNativePayload(action: string, input: string): NativePayload {
  switch (action) {
    case "navigation.start": {
      const destination = extractDestination(input);
      return destination ? { destination } : {};
    }
    case "schedule_native_notification":
      return extractReminder(input);
    case "open_whatsapp_target":
      return extractWhatsAppTarget(input);
    case "recording_control": {
      const normalized = normalize(input);
      const stop = ["deja de grabar", "para de grabar", "deten la grabacion", "termina de grabar", "finaliza la grabacion"]
        .some((phrase) => normalized.includes(phrase));
      return { command: stop ? "stop" : "start" };
    }
    default:
      return {};
  }
}
