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

function cleanValue(value: string) {
  return value.trim().replace(/^['“"]|['”"]$/g, "").replace(/[.!?]+$/, "").trim();
}

function extractDestination(input: string): string | undefined {
  const clean = stripWakeWord(input);
  const patterns = [
    /(?:llevame|llévame|navega|vamos|ve|ir)\s+(?:a|al|hasta)\s+(.+)$/i,
    /(?:ruta|como llego|cómo llego)\s+(?:a|al|hasta)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]?.trim()) return cleanValue(match[1]);
  }
  return undefined;
}

function extractAppName(input: string): string | undefined {
  const clean = stripWakeWord(input);
  const match = clean.match(/(?:abre|abrir|inicia|lanza)\s+(?:la\s+app\s+de\s+|la\s+aplicacion\s+de\s+|la\s+aplicación\s+de\s+|la\s+app\s+|la\s+aplicacion\s+|la\s+aplicación\s+)?(.+)$/i);
  return match?.[1] ? cleanValue(match[1]) : undefined;
}

function extractCallTarget(input: string): NativePayload {
  const clean = stripWakeWord(input);
  const patterns = [
    /(?:llama|llamar|telefonea)\s+(?:a|al)\s+(.+)$/i,
    /(?:haz|hazme)\s+(?:una\s+)?llamada\s+(?:a|al)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) return { target: cleanValue(match[1]) };
  }
  return {};
}

function extractSMS(input: string): NativePayload {
  const clean = stripWakeWord(input);
  const payload: NativePayload = {};
  const messagePatterns = [
    /(?:manda|envia|envía|escribe)\s+(?:un\s+)?(?:sms|mensaje(?:\s+de\s+texto)?)\s+(?:a|para)\s+(.+?)\s+(?:diciendo|que diga|con el mensaje)\s+[“"]?(.+?)[”"]?$/i,
    /(?:sms|mensaje(?:\s+de\s+texto)?)\s+(?:a|para)\s+(.+?)\s*[:,-]\s*(.+)$/i,
  ];
  for (const pattern of messagePatterns) {
    const match = clean.match(pattern);
    if (match?.[1]) payload.target = cleanValue(match[1]);
    if (match?.[2]) payload.message = cleanValue(match[2]);
    if (payload.target) return payload;
  }

  const previousLocation = clean.match(/(?:mandasela|mándasela|enviasela|envíasela|compartela|compártela|manda|envia|envía|comparte)\s+(?:(?:mi|esa|la)\s+ubicaci[oó]n|eso|eso mismo|el resultado)\s+(?:por\s+)?(?:sms|mensaje(?:\s+de\s+texto)?)\s+(?:a|para)\s+(.+)$/i);
  if (previousLocation?.[1]) {
    return {
      target: cleanValue(previousLocation[1]),
      message: /ubicaci[oó]n/i.test(clean) ? "{{last.share}}" : "{{last.value}}",
    };
  }

  const pronoun = clean.match(/(?:mandasela|mándasela|enviasela|envíasela|compartela|compártela)\s+(?:por\s+)?(?:sms|mensaje(?:\s+de\s+texto)?)\s+(?:a|para)\s+(.+)$/i);
  if (pronoun?.[1]) return { target: cleanValue(pronoun[1]), message: "{{last.share}}" };

  const targetOnly = clean.match(/(?:manda|envia|envía|escribe)\s+(?:un\s+)?(?:sms|mensaje(?:\s+de\s+texto)?)\s+(?:a|para)\s+(.+)$/i);
  if (targetOnly?.[1]) payload.target = cleanValue(targetOnly[1]);
  return payload;
}

function extractMediaQuery(input: string): NativePayload {
  const clean = stripWakeWord(input);
  const patterns = [
    /(?:pon|reproduce|reproducir)\s+(?:música|musica|la\s+canción|la\s+cancion|una\s+canción|una\s+cancion|la\s+playlist|playlist)\s+(?:de\s+)?(.+)$/i,
    /(?:pon|reproduce)\s+(.+)\s+(?:en\s+spotify|en\s+youtube)$/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) return { query: cleanValue(match[1]) };
  }

  const generic = clean.match(/(?:pon|reproduce|reproducir)\s+(.+)$/i);
  return generic?.[1] ? { query: cleanValue(generic[1]) } : {};
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

  const quoted = clean.match(/[“"]([^”"]+)[”"]?/);
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

  if (/^(eso|eso mismo|el resultado|lo anterior)$/i.test(payload.body ?? "")) payload.body = "{{last.value}}";
  if (/^(mi ubicaci[oó]n|esa ubicaci[oó]n|la ubicaci[oó]n)$/i.test(payload.body ?? "")) payload.body = "{{last.share}}";

  payload.title = "ZYRON";
  return payload;
}

function extractWhatsAppTarget(input: string): NativePayload {
  const clean = stripWakeWord(input);
  const payload: NativePayload = {};

  const messagePatterns = [
    /(?:manda|envia|envía|escribe)\s+(?:a|para)\s+(.+?)\s+(?:por\s+)?(?:whatsapp|whatsap|watsap)\s*(?:diciendo|que diga|con el mensaje|que|[:,-])\s*[“"]?(.+?)[”"]?$/i,
    /(?:manda|envia|envía|escribe)\s+(?:un\s+)?(?:whatsapp|whatsap|watsap)\s+(?:a|para)\s+(.+?)\s+(?:diciendo|que diga|con el mensaje)\s+[“"]?(.+?)[”"]?$/i,
    /(?:whatsapp|whatsap|watsap)\s+(?:a|para)\s+(.+?)\s*[:,-]\s*(.+)$/i,
  ];
  for (const pattern of messagePatterns) {
    const match = clean.match(pattern);
    if (match?.[1]) payload.target = cleanValue(match[1]);
    if (match?.[2]) payload.message = cleanValue(match[2]);
    if (payload.target) return payload;
  }

  const previousResult = clean.match(/(?:manda|envia|envía|comparte|mandasela|mándasela|enviasela|envíasela|compartela|compártela)\s+(?:(?:mi|esa|la)\s+ubicaci[oó]n|eso|eso mismo|el resultado)?\s*(?:por\s+)?(?:whatsapp|whatsap|watsap)\s+(?:a|para)\s+(.+)$/i);
  if (previousResult?.[1]) {
    return {
      target: cleanValue(previousResult[1]),
      message: /ubicaci[oó]n|mandasela|mándasela|enviasela|envíasela|compartela|compártela/i.test(clean)
        ? "{{last.share}}"
        : "{{last.value}}",
    };
  }

  const targetPatterns = [
    /(?:abre|abrir)\s+(?:el\s+)?(?:chat\s+de\s+)?(?:whatsapp\s+(?:de|con)\s+)?(.+)$/i,
    /(?:whatsapp|whatsap|watsap)(?:\s+(?:a|con|de))?\s+(.+)$/i,
  ];
  for (const pattern of targetPatterns) {
    const match = clean.match(pattern);
    if (!match?.[1]) continue;
    const target = match[1]
      .replace(/^(abre|abrir|escribe|mensaje|chat)\s+/i, "")
      .trim();
    if (target) {
      payload.target = cleanValue(target);
      return payload;
    }
  }

  return payload;
}

export function buildNativePayload(action: string, input: string): NativePayload {
  switch (action) {
    case "navigation.start": {
      const destination = extractDestination(input);
      if (!destination) return {};
      const normalized = normalize(destination);
      if (["casa", "mi casa", "hogar"].includes(normalized)) return { destination, personalPlace: "home" };
      if (["trabajo", "mi trabajo", "oficina", "la oficina"].includes(normalized)) return { destination, personalPlace: "work" };
      if (["eso", "esa ubicacion", "esa ubicación", "el resultado"].includes(normalized)) return { destination: "{{last.value}}" };
      return { destination };
    }
    case "app.open": {
      const app = extractAppName(input);
      return app ? { app } : {};
    }
    case "phone.call":
      return extractCallTarget(input);
    case "messages.sms":
      return extractSMS(input);
    case "media.play":
      return extractMediaQuery(input);
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
