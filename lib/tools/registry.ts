export type ZyronToolName =
  | "tasks"
  | "memory"
  | "conversation"
  | "planner"
  | "calendar"
  | "gmail"
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
      permissions: ["owner_session", "mem0"],
      canWrite: true,
      requiresConfirmation: false,
      status: configured("MEM0_API_KEY") ? "available" : "needs_configuration",
      configurationHint: "Configurar MEM0_API_KEY.",
    },
    conversation: {
      name: "conversation",
      description: "Responde cuando no hace falta ejecutar una acción externa.",
      permissions: ["owner_session", "openai"],
      canWrite: false,
      requiresConfirmation: false,
      status: configured("OPENAI_API_KEY") ? "available" : "needs_configuration",
      configurationHint: "Configurar OPENAI_API_KEY.",
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
    maps: {
      name: "maps",
      description: "Calcula rutas, tiempos de viaje y horas recomendadas de salida.",
      permissions: ["owner_session", "location", "maps"],
      canWrite: false,
      requiresConfirmation: false,
      status: "planned",
    },
    notifications: {
      name: "notifications",
      description: "Envía avisos proactivos al dispositivo del propietario.",
      permissions: ["owner_session", "push"],
      canWrite: true,
      requiresConfirmation: false,
      status: "planned",
    },
  };
}

export function toolSummary() {
  return Object.values(getZyronTools())
    .map((tool) => `${tool.name} [${tool.status}]: ${tool.description}`)
    .join("\n");
}
