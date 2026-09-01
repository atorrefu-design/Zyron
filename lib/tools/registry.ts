export type ZyronToolName =
  | "tasks"
  | "memory"
  | "conversation"
  | "planner"
  | "calendar"
  | "gmail"
  | "drive"
  | "proactive"
  | "maps"
  | "notifications";

export type ZyronToolStatus = "available" | "needs_configuration" | "planned";

export type ZyronToolDefinition = {
  name: ZyronToolName;
  description: string;
  permissions: string[];
  canWrite: boolean;
  requiresConfirmation: boolean;
  status: ZyronToolStatus;
  configurationHint?: string;
};

function configured(...variables: string[]) {
  return variables.some((name) => Boolean(process.env[name]));
}

function allConfigured(...variables: string[]) {
  return variables.every((name) => Boolean(process.env[name]));
}

export function getZyronTools(): Record<ZyronToolName, ZyronToolDefinition> {
  const databaseReady = configured("DATABASE_URL", "POSTGRES_URL");
  const googleReady = allConfigured("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ZYRON_AUTH_SECRET");
  const pushReady = databaseReady && configured("ZYRON_AUTH_SECRET");
  const mapsReady = configured("GOOGLE_MAPS_API_KEY");

  return {
    tasks: {
      name: "tasks",
      description: "Crea, consulta, completa y elimina tareas persistentes del propietario.",
      permissions: ["owner_session", "database"],
      canWrite: true,
      requiresConfirmation: false,
      status: databaseReady ? "available" : "needs_configuration",
      configurationHint: "Configurar DATABASE_URL o POSTGRES_URL.",
    },
    memory: {
      name: "memory",
      description: "Recupera y guarda hechos, preferencias, proyectos y decisiones útiles a largo plazo.",
      permissions: ["owner_session", "database"],
      canWrite: true,
      requiresConfirmation: false,
      status: databaseReady ? "available" : "needs_configuration",
      configurationHint: "Configurar DATABASE_URL o POSTGRES_URL.",
    },
    conversation: {
      name: "conversation",
      description: "Responde cuando no hace falta ejecutar una acción externa.",
      permissions: ["owner_session", "ai_provider"],
      canWrite: false,
      requiresConfirmation: false,
      status: configured("OPENAI_API_KEY", "AI_GATEWAY_API_KEY") ? "available" : "needs_configuration",
      configurationHint: "Configurar OPENAI_API_KEY y, para Claude/Gemini, AI_GATEWAY_API_KEY.",
    },
    planner: {
      name: "planner",
      description: "Ordena las tareas pendientes y prepara un plan práctico del día.",
      permissions: ["owner_session", "database"],
      canWrite: false,
      requiresConfirmation: false,
      status: databaseReady ? "available" : "needs_configuration",
      configurationHint: "Configurar DATABASE_URL o POSTGRES_URL.",
    },
    calendar: {
      name: "calendar",
      description: "Consulta y gestiona eventos del Google Calendar conectado del propietario.",
      permissions: ["owner_session", "google_oauth", "calendar.events"],
      canWrite: true,
      requiresConfirmation: true,
      status: googleReady ? "available" : "needs_configuration",
      configurationHint: "Configurar Google OAuth y autorizar el scope calendar.events.",
    },
    gmail: {
      name: "gmail",
      description: "Busca y consulta de forma privada mensajes del Gmail conectado. El envío aún no está habilitado.",
      permissions: ["owner_session", "google_oauth", "gmail.readonly"],
      canWrite: false,
      requiresConfirmation: false,
      status: googleReady ? "available" : "needs_configuration",
      configurationHint: "Configurar Google OAuth y autorizar el scope gmail.readonly.",
    },
    drive: {
      name: "drive",
      description: "Busca y consulta Drive; crea carpetas y documentos nuevos únicamente tras confirmación explícita.",
      permissions: ["owner_session", "google_oauth", "drive.readonly", "drive.file"],
      canWrite: true,
      requiresConfirmation: true,
      status: googleReady ? "available" : "needs_configuration",
      configurationHint: "Configurar Google OAuth, habilitar Drive API y autorizar drive.readonly y drive.file.",
    },
    proactive: {
      name: "proactive",
      description: "Cruza salud del núcleo, tareas, agenda y correo para detectar asuntos que conviene atender antes de que el propietario pregunte.",
      permissions: ["owner_session", "database", "google_oauth", "openai"],
      canWrite: false,
      requiresConfirmation: false,
      status: databaseReady && googleReady && configured("OPENAI_API_KEY") ? "available" : "needs_configuration",
      configurationHint: "Requiere base de datos, Google OAuth y OpenAI configurados.",
    },
    maps: {
      name: "maps",
      description: "Calcula rutas en coche, tráfico y horas recomendadas de salida desde la ubicación actual del dispositivo.",
      permissions: ["owner_session", "device_location", "google_routes"],
      canWrite: false,
      requiresConfirmation: false,
      status: mapsReady ? "available" : "needs_configuration",
      configurationHint: "Configurar GOOGLE_MAPS_API_KEY y habilitar Google Routes API.",
    },
    notifications: {
      name: "notifications",
      description: "Envía avisos proactivos mediante Web Push al dispositivo del propietario, incluso con ZYRON cerrado.",
      permissions: ["owner_session", "push", "service_worker"],
      canWrite: true,
      requiresConfirmation: false,
      status: pushReady ? "available" : "needs_configuration",
      configurationHint: "Requiere base de datos y ZYRON_AUTH_SECRET para proteger las claves push.",
    },
  };
}

export function toolSummary() {
  return Object.values(getZyronTools())
    .map((tool) => `${tool.name} [${tool.status}]: ${tool.description}`)
    .join("\n");
}
