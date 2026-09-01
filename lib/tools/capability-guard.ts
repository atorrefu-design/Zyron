import { getZyronTools, type ZyronToolName } from "./registry";

export type CapabilityRequest = {
  tool: ZyronToolName;
  confidence: number;
};

const patterns: Array<{ tool: ZyronToolName; pattern: RegExp }> = [
  { tool: "calendar", pattern: /\b(calendario|agenda|evento|reuni[oó]n|cita|hueco libre|disponibilidad)\b/i },
  { tool: "gmail", pattern: /\b(gmail|correo|email|e-mail|bandeja de entrada|mensaje recibido)\b/i },
  { tool: "drive", pattern: /\b(google drive|drive|documento|archivo|carpeta)\b/i },
  { tool: "maps", pattern: /\b(maps|ruta|tr[aá]fico|ubicaci[oó]n|cu[aá]nto tardo|hora de salida|c[oó]mo llego)\b/i },
  { tool: "notifications", pattern: /\b(notif[ií]came|av[ií]same|aviso|notificaci[oó]n|alerta)\b/i },
];

export function detectCapabilityRequest(message: string): CapabilityRequest | null {
  const clean = message.trim();
  for (const item of patterns) {
    if (item.pattern.test(clean)) return { tool: item.tool, confidence: 0.92 };
  }
  return null;
}

export function unavailableCapabilityReply(message: string) {
  const request = detectCapabilityRequest(message);
  if (!request) return null;

  const tool = getZyronTools()[request.tool];
  if (tool.status === "available") return null;

  const labels: Record<ZyronToolName, string> = {
    tasks: "Tareas",
    memory: "Memoria",
    conversation: "Conversación",
    planner: "Planificador",
    calendar: "Google Calendar",
    gmail: "Gmail",
    drive: "Google Drive",
    proactive: "Proactividad",
    maps: "Mapas y rutas",
    notifications: "Notificaciones",
  };

  const state = tool.status === "planned"
    ? "todavía no está implementada"
    : "necesita terminar su configuración";

  return {
    reply: `La capacidad de ${labels[request.tool]} ${state}. No voy a fingir que he ejecutado esa acción. Puedes seguir usando conversación, memoria y tareas mientras terminamos esta conexión.`,
    action: "capability_unavailable",
    tool: request.tool,
    status: tool.status,
  };
}
