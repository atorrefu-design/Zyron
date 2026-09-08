export type ZyronAgentToolName =
  | "list_tasks"
  | "create_task"
  | "complete_task"
  | "delete_task"
  | "build_daily_plan"
  | "get_operational_briefing"
  | "list_goals"
  | "create_goal"
  | "assign_task_to_goal"
  | "get_system_status"
  | "list_recent_actions"
  | "search_memory"
  | "remember_fact"
  | "read_calendar"
  | "create_calendar_event"
  | "create_calendar_events"
  | "delete_calendar_event"
  | "search_places"
  | "get_driving_route"
  | "search_gmail"
  | "read_gmail_message"
  | "create_gmail_draft"
  | "search_drive"
  | "read_drive_file"
  | "create_drive_folder"
  | "create_drive_document"
  | "search_current_web"
  | "get_weather_forecast";

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
  delete_task: {
    risk: "high",
    effect: "reversible_write",
    requiresExplicitRequest: true,
    requiresConfirmation: true,
  },
  build_daily_plan: { risk: "low", effect: "read", requiresExplicitRequest: false },
  get_operational_briefing: { risk: "low", effect: "read", requiresExplicitRequest: false },
  list_goals: { risk: "low", effect: "read", requiresExplicitRequest: false },
  create_goal: { risk: "low", effect: "reversible_write", requiresExplicitRequest: true },
  assign_task_to_goal: { risk: "low", effect: "reversible_write", requiresExplicitRequest: true },
  get_system_status: { risk: "low", effect: "read", requiresExplicitRequest: false },
  list_recent_actions: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  search_memory: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  remember_fact: { risk: "medium", effect: "persistent_write", requiresExplicitRequest: true },
  read_calendar: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  create_calendar_event: {
    risk: "medium",
    effect: "reversible_write",
    requiresExplicitRequest: true,
    requiresConfirmation: true,
  },
  create_calendar_events: {
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
  create_gmail_draft: { risk: "medium", effect: "reversible_write", requiresExplicitRequest: true },
  search_drive: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  read_drive_file: { risk: "medium", effect: "read", requiresExplicitRequest: false },
  create_drive_folder: { risk: "medium", effect: "reversible_write", requiresExplicitRequest: true, requiresConfirmation: true },
  create_drive_document: { risk: "medium", effect: "reversible_write", requiresExplicitRequest: true, requiresConfirmation: true },
  search_current_web: { risk: "low", effect: "read", requiresExplicitRequest: false },
  get_weather_forecast: { risk: "low", effect: "read", requiresExplicitRequest: false },
};

function explicitlyRequestsMemory(message: string) {
  const clean = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return /(?:^|\b)(recuerda|memoriza|guarda\s+(?:(?:en\s+)?(?:(?:tu|la)\s+)?memoria)|guardalo(?:\s+en\s+(?:(?:tu|la)\s+)?memoria)?|a\s+partir\s+de\s+ahora)(?:\b|\s|[,.!])/i.test(clean);
}

function normalizeRequest(message: string) {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function explicitlyRequestsGoalCreation(message: string) {
  const clean = normalizeRequest(message);
  return /\b(?:crea|crear|anade|anadir|nuevo|nueva|abre)\b[^.!?]{0,100}\b(?:objetivo|proyecto|meta)\b|\b(?:objetivo|proyecto|meta)\b[^.!?]{0,100}\b(?:crea|crear|anade|anadir|nuevo|nueva|abre)\b/.test(clean);
}

function explicitlyRequestsGoalAssignment(message: string) {
  const clean = normalizeRequest(message);
  return /\b(?:asigna|asignar|vincula|vincular|relaciona|relacionar|mete|incluir|incluye)\b[^.!?]{0,160}\b(?:tarea|objetivo|proyecto|meta)\b/.test(clean);
}

function explicitlyRequestsEmailDraft(message: string) {
  const clean = normalizeRequest(message);
  return /\b(?:crea|crear|prepara|preparar|redacta|redactar|escribe|escribir)\b[^.!?]{0,180}\b(?:borrador|correo|email|e-mail)\b|\b(?:borrador|correo|email|e-mail)\b[^.!?]{0,180}\b(?:crea|crear|prepara|preparar|redacta|redactar|escribe|escribir)\b/.test(clean);
}

export function explicitlyConfirmsAgentAction(message: string, tool?: ZyronAgentToolName) {
  const clean = normalizeRequest(message).replace(/[.!]+$/, "");
  if (/^(?:si[,.!]?\s+)?(?:confirmo|confirmado|confirmada|confirma|adelante|hazlo)$/.test(clean)) return true;

  if (tool === "create_calendar_event" || tool === "create_calendar_events" || !tool) {
    if (/^(?:si[,.!]?\s+)?(?:confirmar\s+creacion|confirmo\s+la\s+creacion|crealo|crealos|crea(?:\s+el|\s+los)?\s+eventos?)$/.test(clean)) return true;
  }
  if (tool === "delete_calendar_event" || tool === "delete_task" || !tool) {
    if (/^(?:si[,.!]?\s+)?(?:borralo|eliminalo|cancela(?:\s+el)?\s+evento)$/.test(clean)) return true;
  }
  if (tool === "create_drive_folder" || !tool) {
    if (/^(?:(?:si|confirmo)[,.!]?\s+(?:crea|creala|crea(?:\s+la)?\s+carpeta)|(?:creala|crea\s+la\s+carpeta))$/.test(clean)) return true;
  }
  if (tool === "create_drive_document" || !tool) {
    if (/^(?:(?:si|confirmo)[,.!]?\s+)?(?:guardalo|crea(?:\s+el)?\s+documento|guarda(?:\s+el)?\s+documento)$/.test(clean)) return true;
  }
  return false;
}

export const explicitlyConfirmsCalendarAction = explicitlyConfirmsAgentAction;

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

  if (name === "create_goal" && !explicitlyRequestsGoalCreation(userMessage)) {
    return {
      allowed: false,
      reason: "ZYRON solo crea un objetivo o proyecto cuando Aarón lo pide explícitamente.",
      policy,
    };
  }

  if (name === "assign_task_to_goal" && !explicitlyRequestsGoalAssignment(userMessage)) {
    return {
      allowed: false,
      reason: "ZYRON solo vincula una tarea con un objetivo cuando Aarón lo pide explícitamente.",
      policy,
    };
  }

  if (name === "create_gmail_draft" && !explicitlyRequestsEmailDraft(userMessage)) {
    return {
      allowed: false,
      reason: "ZYRON solo crea un borrador de Gmail cuando Aarón lo pide explícitamente; nunca lo envía.",
      policy,
    };
  }

  if (policy.requiresConfirmation && !explicitlyConfirmsAgentAction(userMessage, name)) {
    return {
      allowed: false,
      reason: "Antes de ejecutar esta escritura, ZYRON debe mostrar el resumen, el destino y el alcance; Aarón debe confirmarlo en un mensaje posterior.",
      policy,
    };
  }

  return { allowed: true, reason: "Acción permitida por la política del propietario.", policy };
}

export function listAgentToolPolicies() {
  return { ...TOOL_POLICIES };
}
