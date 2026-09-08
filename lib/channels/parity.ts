export type TelegramCapabilityState = "direct" | "agent" | "iphone";

export const telegramCapabilityMatrix = [
  { capability: "Memoria canónica", state: "direct", detail: "Lectura y escritura en PostgreSQL/Neon; los comandos directos no usan IA." },
  { capability: "Tareas", state: "direct", detail: "Listar, crear, completar y planificar sin IA; borrar mediante el agente con confirmación." },
  { capability: "Calendario", state: "agent", detail: "Leer, crear y borrar con las confirmaciones de seguridad." },
  { capability: "Gmail", state: "agent", detail: "Buscar y leer; sin envío ni borrado." },
  { capability: "Google Drive", state: "agent", detail: "Buscar, leer, crear carpetas y documentos; escrituras con confirmación." },
  { capability: "Ubicación y rutas", state: "agent", detail: "Última ubicación compartida, lugares y rutas con tráfico." },
  { capability: "Información actual", state: "agent", detail: "Consulta web verificada cuando la petición depende de datos vigentes." },
  { capability: "Voz de entrada", state: "agent", detail: "Transcribe notas de voz y las procesa con el mismo núcleo." },
  { capability: "Acciones del iPhone", state: "iphone", detail: "Abrir apps, llamadas, SMS/WhatsApp, grabación y notificaciones requieren el companion." },
] as const satisfies ReadonlyArray<{ capability: string; state: TelegramCapabilityState; detail: string }>;

export function renderTelegramCapabilities() {
  const groups: Array<[TelegramCapabilityState, string]> = [
    ["direct", "Directo, sin IA"],
    ["agent", "Núcleo ZYRON"],
    ["iphone", "Requiere iPhone"],
  ];
  const lines = ["Estado real de Telegram como extensión de ZYRON:"];
  for (const [state, label] of groups) {
    lines.push(`\n${label}:`);
    for (const item of telegramCapabilityMatrix.filter((entry) => entry.state === state)) {
      lines.push(`• ${item.capability}: ${item.detail}`);
    }
  }
  lines.push("\nNo existe una memoria separada de Telegram.");
  return lines.join("\n");
}
