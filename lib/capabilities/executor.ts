import { type CapabilityRoute } from "./router";

export type CapabilityExecutionPlan = {
  capabilityId: string;
  mode: "execute" | "handoff" | "request_access" | "fallback";
  endpoint?: string;
  nativeAction?: string;
  userMessage?: string;
  requiresConfirmation: boolean;
};

const EXECUTORS: Record<string, Omit<CapabilityExecutionPlan, "capabilityId" | "requiresConfirmation">> = {
  "calendar.events": {
    mode: "execute",
    endpoint: "/api/calendar/command",
  },
  "tasks.manage": {
    mode: "execute",
    endpoint: "/api/tasks",
  },
  "location.current": {
    mode: "request_access",
    nativeAction: "request_location",
    userMessage: "Necesito la ubicación actual del iPhone para resolver esta petición.",
  },
  "maps.mobility": {
    mode: "execute",
    endpoint: "/api/maps/route",
  },
  "basketball.fcbq": {
    mode: "fallback",
    userMessage: "Todavía no tengo conectado el adaptador de FCBQ. Puedo usar la fuente oficial en cuanto esté disponible.",
  },
  "recordings.import": {
    mode: "request_access",
    nativeAction: "share_or_select_recording",
    userMessage: "Compárteme la grabación o autoriza el archivo para poder analizarla.",
  },
  "whatsapp.handoff": {
    mode: "handoff",
    nativeAction: "open_whatsapp",
    userMessage: "Puedo llevarte a WhatsApp o al chat compatible, pero no leer conversaciones privadas por detrás.",
  },
  "files.authorized": {
    mode: "request_access",
    nativeAction: "select_file_or_folder",
    userMessage: "Necesito que autorices el archivo o carpeta que quieres que use.",
  },
  "notifications.native": {
    mode: "handoff",
    nativeAction: "schedule_native_notification",
    userMessage: "Esta acción necesita el companion del iPhone para crear el aviso nativo.",
  },
};

export function buildCapabilityExecutionPlan(route: CapabilityRoute): CapabilityExecutionPlan {
  const base = EXECUTORS[route.capability.id];
  if (!base) {
    return {
      capabilityId: route.capability.id,
      mode: "fallback",
      userMessage: route.capability.fallback || "Esta capacidad todavía no tiene un ejecutor conectado.",
      requiresConfirmation: route.capability.requiresConfirmation,
    };
  }

  const mode = route.fallbackOnly && base.mode === "execute" ? "fallback" : base.mode;
  return {
    capabilityId: route.capability.id,
    ...base,
    mode,
    requiresConfirmation: route.capability.requiresConfirmation,
  };
}
