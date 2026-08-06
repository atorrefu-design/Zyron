export type ZyronToolName =
  | "tasks"
  | "memory"
  | "conversation"
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

export function getZyronTools(): Record<ZyronToolName, ZyronToolDefinition> {
  return {
    tasks: {
      name: "tasks",
      description: "Crea, consulta, completa y elimina tareas persistentes del propietario.",
      permissions: ["owner_session", "database"],
      canWrite: true,
      requiresConfirmation: false,
      status: configured("DATABASE_URL", "POSTGRES_URL") ? "available" : "needs_configuration",
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
    calendar: {
      name: "calendar",
      description: "Consulta disponibilidad y gestiona eventos del calendario del propietario.",
      permissions: ["owner_session", "google_oauth", "calendar"],
      canWrite: true,
      requiresConfirmation: true,
      status: "planned",
    },
    gmail: {
      name: "gmail",
      description: "Busca, resume, redacta y envía correo del propietario.",
      permissions: ["owner_session", "google_oauth", "gmail"],
      canWrite: true,
      requiresConfirmation: true,
      status: "planned",
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
