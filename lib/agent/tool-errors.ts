export type ZyronToolFailure = {
  summary: string;
  code: string;
};

export function classifyAgentToolFailure(tool: string, error: unknown): ZyronToolFailure {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  const calendarWrite = tool === "create_calendar_event" || tool === "delete_calendar_event";
  const mapsRead = tool === "search_places" || tool === "get_driving_route";
  const gmailRead = tool === "search_gmail" || tool === "read_gmail_message";

  if (gmailRead && (
    message.includes("google_not_connected")
    || message.includes("gmail_scope_missing")
    || message.includes("google_token_refresh_400")
    || message.includes("gmail_api_401")
  )) {
    return {
      code: "gmail_reconnect_required",
      summary: "Gmail no está autorizado o la conexión de Google ha caducado. Reautoriza Google desde el panel de ZYRON.",
    };
  }

  if (gmailRead && message.includes("gmail_api_403")) {
    return {
      code: "gmail_api_unavailable",
      summary: "Google ha denegado la consulta de Gmail. Comprueba que Gmail API esté habilitada para ZYRON y vuelve a autorizar Google.",
    };
  }

  if (gmailRead && message.includes("gmail_api_404")) {
    return {
      code: "gmail_message_not_found",
      summary: "Ese correo ya no está disponible o el identificador ha caducado. Vuelve a buscarlo.",
    };
  }

  if (mapsRead && (message.includes("maps_api_key_missing") || /maps_(?:places|routes)_403/.test(message))) {
    return {
      code: "maps_configuration_required",
      summary: "Google Maps no está autorizado para esta operación. Revisa la clave y las APIs Routes/Places en la configuración de ZYRON.",
    };
  }

  if (mapsRead && (message.includes("maps_route_unavailable") || message.includes("ZERO_RESULTS"))) {
    return {
      code: "maps_route_unavailable",
      summary: "Google Maps no ha encontrado una ruta en coche para ese origen y destino.",
    };
  }

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
