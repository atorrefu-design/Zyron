import { zyronCapabilities, type ZyronCapability } from "./registry";

export type CapabilityRoute = {
  capability: ZyronCapability;
  score: number;
  reason: string;
  fallbackOnly: boolean;
};

type Rule = {
  capabilityId: string;
  terms: string[];
  phrases?: string[];
  reason: string;
};

const RULES: Rule[] = [
  {
    capabilityId: "calendar.events",
    terms: ["calendario", "agenda", "evento", "cita", "reunión", "reunion"],
    phrases: ["qué tengo hoy", "que tengo hoy", "qué tengo mañana", "que tengo mañana"],
    reason: "La petición parece relacionada con agenda o eventos.",
  },
  {
    capabilityId: "tasks.manage",
    terms: ["tarea", "pendiente", "apunta", "anota", "lista"],
    phrases: ["recuérdame hacer", "recuerdame hacer"],
    reason: "La petición parece una tarea o pendiente gestionable por ZYRON.",
  },
  {
    capabilityId: "location.current",
    terms: ["ubicación", "ubicacion", "dónde estoy", "donde estoy", "cerca de mí", "cerca de mi"],
    reason: "La petición necesita o probablemente se beneficia de la ubicación actual.",
  },
  {
    capabilityId: "phone.call",
    terms: ["llama", "llamar", "telefonea", "teléfono", "telefono"],
    phrases: ["llama a", "llamar a", "telefonea a", "haz una llamada a"],
    reason: "La petición pide preparar una llamada telefónica.",
  },
  {
    capabilityId: "messages.sms",
    terms: ["sms", "mensaje de texto"],
    phrases: ["manda un mensaje a", "envía un mensaje a", "envia un mensaje a", "manda un sms a", "envía un sms a", "envia un sms a"],
    reason: "La petición pide preparar un mensaje SMS o de texto.",
  },
  {
    capabilityId: "media.play",
    terms: ["música", "musica", "canción", "cancion", "reproduce", "reproducir", "playlist"],
    phrases: ["pon música", "pon musica", "pon la canción", "pon la cancion", "reproduce música", "reproduce musica", "reproduce la canción", "reproduce la cancion"],
    reason: "La petición pide abrir o reproducir contenido multimedia.",
  },
  {
    capabilityId: "apps.open",
    terms: ["abre", "abrir", "inicia", "lanza", "spotify", "youtube", "instagram", "telegram", "whatsapp"],
    phrases: ["abre spotify", "abre youtube", "abre la app", "abre la aplicación", "abre la aplicacion"],
    reason: "La petición pide abrir directamente una aplicación del iPhone.",
  },
  {
    capabilityId: "maps.navigation",
    terms: ["llévame", "llevame", "navega", "navegación", "navegacion"],
    phrases: ["llévame a", "llevame a", "navega hasta", "navega a", "vamos a"],
    reason: "La petición pide iniciar navegación en el iPhone.",
  },
  {
    capabilityId: "maps.mobility",
    terms: ["tráfico", "trafico", "ruta", "llegar", "tardo", "maps", "movilidad", "coche"],
    phrases: ["cuánto tardo", "cuanto tardo", "cómo llego", "como llego"],
    reason: "La petición parece de movilidad, tráfico o cálculo de ruta.",
  },
  {
    capabilityId: "recording.control",
    terms: ["graba", "grabar", "grabando", "grabación", "grabacion", "grabadora", "deja de grabar", "para de grabar"],
    phrases: ["graba la siguiente conversación", "graba esta conversación", "empieza a grabar", "deja de grabar", "para de grabar"],
    reason: "La petición pide controlar directamente una grabación en el iPhone.",
  },
  {
    capabilityId: "basketball.fcbq",
    terms: ["fcbq", "federación", "federacion", "básquet", "basquet", "baloncesto", "clasificación", "clasificacion", "acta"],
    phrases: ["cuándo juega", "cuando juega", "próximo partido", "proximo partido"],
    reason: "La petición parece depender de información federativa o de baloncesto.",
  },
  {
    capabilityId: "web.current_info",
    terms: ["resultado", "marcador", "último partido", "ultimo partido", "noticia", "hoy", "actual", "ahora"],
    phrases: ["resultado del último partido", "resultado del ultimo partido", "qué pasó", "que paso"],
    reason: "La petición requiere información actual y debe resolverse consultando una fuente vigente.",
  },
  {
    capabilityId: "recordings.import",
    terms: ["audio guardado", "nota de voz", "entreno grabado", "archivo de audio"],
    phrases: ["última grabación", "ultima grabacion", "analiza la grabación", "analiza la grabacion"],
    reason: "La petición parece requerir una grabación ya existente o un archivo de audio autorizado.",
  },
  {
    capabilityId: "whatsapp.handoff",
    terms: ["whatsapp", "wasap", "chat"],
    phrases: ["abre el chat", "escribe a", "manda un whatsapp"],
    reason: "La petición parece requerir una acción o traspaso hacia WhatsApp.",
  },
  {
    capabilityId: "files.authorized",
    terms: ["archivo", "documento", "pdf", "excel", "carpeta", "fichero"],
    reason: "La petición parece depender de un archivo autorizado.",
  },
  {
    capabilityId: "notifications.native",
    terms: ["avísame", "avisame", "notificación", "notificacion", "alerta"],
    reason: "La petición parece necesitar un aviso nativo en el iPhone.",
  },
];

function normalize(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function capabilityById(id: string) {
  return zyronCapabilities.find((capability) => capability.id === id);
}

export function routeCapabilities(input: string): CapabilityRoute[] {
  const text = normalize(input.trim());
  if (!text) return [];

  const routes: CapabilityRoute[] = [];

  for (const rule of RULES) {
    const capability = capabilityById(rule.capabilityId);
    if (!capability) continue;

    let score = 0;
    for (const term of rule.terms) {
      if (text.includes(normalize(term))) score += 2;
    }
    for (const phrase of rule.phrases ?? []) {
      if (text.includes(normalize(phrase))) score += 4;
    }

    if (score === 0) continue;
    routes.push({
      capability,
      score,
      reason: rule.reason,
      fallbackOnly: capability.status === "planned" || capability.accessLevel === "handoff",
    });
  }

  return routes.sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
}

export function selectPrimaryCapability(input: string): CapabilityRoute | null {
  return routeCapabilities(input)[0] ?? null;
}
