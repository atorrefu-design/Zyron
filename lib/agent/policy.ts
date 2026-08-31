export type ZyronAgentToolName =
  | "list_tasks"
  | "create_task"
  | "complete_task"
  | "build_daily_plan"
  | "search_memory"
  | "remember_fact"
  | "read_calendar";

export type ZyronAgentToolPolicy = {
  risk: "low" | "medium" | "high";
  effect: "read" | "reversible_write" | "persistent_write";
  requiresExplicitRequest: boolean;
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
};

function explicitlyRequestsMemory(message: string) {
  return /(?:^|\b)(recuerda|memoriza|guarda\s+(?:en\s+tu\s+)?memoria|a\s+partir\s+de\s+ahora)(?:\b|\s)/i.test(message);
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

  return { allowed: true, reason: "Acción permitida por la política del propietario.", policy };
}

export function listAgentToolPolicies() {
  return { ...TOOL_POLICIES };
}
