export type ZyronToolFailure = {
  summary: string;
  code: string;
};

export function classifyAgentToolFailure(tool: string, error: unknown): ZyronToolFailure {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  const calendarWrite = tool === "create_calendar_event" || tool === "delete_calendar_event";

  if (calendarWrite && (
    message.includes("google_not_connected")
    || message.includes("google_token_refresh_400")
    || message.includes("google_access_token_missing")
    || message.includes("google_calendar_create_401")
    || message.includes("google_calendar_delete_401")
  )) {
    return {
      code: "google_reconnect_required",
      summary: "La conexión de Google ha caducado o ya no es válida. Reconecta Google desde el panel de ZYRON y vuelve a intentarlo.",
    };
  }

  if (calendarWrite && (
    message.includes("google_calendar_create_403")
    || message.includes("google_calendar_delete_403")
    || message.includes("insufficientPermissions")
    || message.includes("insufficient permission")
  )) {
    return {
      code: "calendar_write_scope_missing",
      summary: "Google Calendar está conectado solo para lectura o sin permiso suficiente. Reconecta Google desde el panel de ZYRON para autorizar la gestión de eventos.",
    };
  }

  return {
    code: "tool_temporarily_unavailable",
    summary: `La herramienta ${tool} no está disponible temporalmente. No se ha programado ningún reintento automático.`,
  };
}
