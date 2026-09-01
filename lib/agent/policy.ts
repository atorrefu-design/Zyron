export type ZyronAgentToolName =
  | "list_tasks"
  | "create_task"
  | "complete_task"
  | "build_daily_plan"
  | "search_memory"
  | "remember_fact"
  | "read_calendar"
  | "create_calendar_event"
  | "delete_calendar_event"
  | "search_places"
  | "get_driving_route"
  | "search_gmail"
  | "read_gmail_message"
  | "search_drive"
  | "read_drive_file";

export type ZyronAgentToolPolicy = {
  risk: "low" | "medium" | "high";
  effect: "read" | "reversible_write" | "persistent_write";
  requiresExplicitRequest: boolean;
  requiresConfirmation?: boolean;
};

export type ZyronAgentAuthorization = {
  allowed: boolean;
  reason: string;
  policy?: ZyronAgentToolPolicy;
};

const TOOL_POLICIES: Record<ZyronAgentToolName, ZyronAgentToolPolicy> = {
  list_tasks: { risk: "low", effect: "read", requiresExplicitRequest: false },
  create_task: { risk: "low", effect: "reversible_write", requiresExplicitRequest: false },
  complete_task: { risk: "low", effect: "reversible_write", requiresExplicitRequest: false },
  build_daily_plan: { risk: "low", effect: "read", requiresExplicitRequest: false },
  search_memory: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  remember_fact: { risk: "medium", effect: "persistent_write", requiresExplicitRequest: true },
  read_calendar: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  create_calendar_event: {
    risk: "medium",
    effect: "reversible_write",
    requiresExplicitRequest: true,
    requiresConfirmation: true,
  },
  delete_calendar_event: {
    risk: "high",
    effect: "reversible_write",
    requiresExplicitRequest: true,
    requiresConfirmation: true,
  },
  search_places: { risk: "low", effect: "read", requiresExplicitRequest: false },
  get_driving_route: { risk: "low", effect: "read", requiresExplicitRequest: false },
  search_gmail: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  read_gmail_message: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  search_drive: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  read_drive_file: { risk: "medium", effect: "read", requiresExplicitRequest: false },
};

function explicitlyRequestsMemory(message: string) {
  return /(?:^|\b)(recuerda|memoriza|guarda\s+(?:en\s+tu\s+)?memoria|a\s+partir\s+de\s+ahora)(?:\b|\s)/i.test(message);
}

export function explicitlyConfirmsCalendarAction(message: string) {
  const clean = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return /^(?:si[,.!]?\s+)?(?:confirmo|confirmado|confirma|adelante|hazlo|crealo|crea(?:\s+el)?\s+evento|borralo|eliminalo|cancela(?:\s+el)?\s+evento)(?:[.!]|\s|$)/.test(clean);
}

export function authorizeAgentTool(tool: string, userMessage: string): ZyronAgentAuthorization {
  if (!(tool in TOOL_POLICIES)) {
    return { allowed: false, reason: "La herramienta no forma parte del catálogo autorizado de ZYRON." };
  }

  const name = tool as ZyronAgentToolName;
  const policy = TOOL_POLICIES[name];
  if (name === "remember_fact" && !explicitlyRequestsMemory(userMessage)) {
    return {
      allowed: false,
      reason: "La memoria permanente solo se escribe cuando Aarón lo pide explícitamente.",
      policy,
    };
  }

  if (policy.requiresConfirmation && !explicitlyConfirmsCalendarAction(userMessage)) {
    return {
      allowed: false,
      reason: "Antes de modificar la agenda, ZYRON debe mostrar el resumen y Aarón debe confirmarlo en un mensaje posterior.",
      policy,
    };
  }

  return { allowed: true, reason: "Acción permitida por la política del propietario.", policy };
}

export function listAgentToolPolicies() {
  return { ...TOOL_POLICIES };
}
