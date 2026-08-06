export type ZyronToolName = "tasks" | "memory" | "conversation";

export type ZyronToolDefinition = {
  name: ZyronToolName;
  description: string;
  permissions: string[];
  canWrite: boolean;
  requiresConfirmation: boolean;
};

export const ZYRON_TOOLS: Record<ZyronToolName, ZyronToolDefinition> = {
  tasks: {
    name: "tasks",
    description: "Crea, consulta, completa y elimina tareas persistentes del propietario.",
    permissions: ["owner_session", "database"],
    canWrite: true,
    requiresConfirmation: false,
  },
  memory: {
    name: "memory",
    description: "Recupera y guarda hechos, preferencias, proyectos y decisiones útiles a largo plazo.",
    permissions: ["owner_session", "mem0"],
    canWrite: true,
    requiresConfirmation: false,
  },
  conversation: {
    name: "conversation",
    description: "Responde cuando no hace falta ejecutar una acción externa.",
    permissions: ["owner_session", "openai"],
    canWrite: false,
    requiresConfirmation: false,
  },
};

export function toolSummary() {
  return Object.values(ZYRON_TOOLS)
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");
}
