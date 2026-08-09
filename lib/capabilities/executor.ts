import { type CapabilityRoute } from "./router";

export type CapabilityExecutionPlan = {
  capabilityId: string;
  mode: "execute" | "native_execute" | "handoff" | "request_access" | "fallback";
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
    mode: "native_execute",
    nativeAction: "get_current_location",
  },
  "maps.mobility": {
    mode: "execute",
    endpoint: "/api/maps/route",
  },
  "web.current_info": {
    mode: "execute",
    endpoint: "/api/search/current",
  },
  "basketball.fcbq": {
    mode: "execute",
    endpoint: "/api/search/current",
    userMessage: "Prioriza la fuente oficial de FCBQ cuando exista; si no, usa la mejor fuente fiable disponible.",
  },
  "recording.control": {
    mode: "native_execute",
    nativeAction: "recording_control",
  },
  "recordings.import": {
    mode: "request_access",
    nativeAction: "share_or_select_recording",
    userMessage: "Necesito acceso al archivo concreto para analizar una grabación ya existente.",
  },
  "whatsapp.handoff": {
    mode: "native_execute",
    nativeAction: "open_whatsapp_target",
  },
  "files.authorized": {
    mode: "request_access",
    nativeAction: "select_file_or_folder",
    userMessage: "Necesito acceso al archivo o carpeta concreta que aún no está autorizada.",
  },
  "notifications.native": {
    mode: "native_execute",
    nativeAction: "schedule_native_notification",
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

  const mode = route.fallbackOnly && (base.mode === "execute" || base.mode === "native_execute")
    ? "fallback"
    : base.mode;

  return {
    capabilityId: route.capability.id,
    ...base,
    mode,
    requiresConfirmation: route.capability.requiresConfirmation,
  };
}
