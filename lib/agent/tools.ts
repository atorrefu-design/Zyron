import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { buildDailyPlan, formatDailyPlan } from "../tools/planner";
import { assignTaskToGoal, createGoal, createTask, deleteTask, listActions, listGoals, listTasks, recordAction, setTaskCompleted } from "../db";
import { createCalendarEvent, deleteCalendarEvent, listCalendarEvents } from "../google/calendar";
import { searchPlacesText } from "../google/places";
import { computeDrivingRoute, planDepartureForArrival, type RoutePoint } from "../google/routes";
import { buildNavigationLinks, validSharedLocation } from "../maps-links";
import { normalizeGmailQuery, validGmailMessageId } from "../gmail-query";
import { compactSender, createGmailDraft, listGmailMessages, readGmailMessage } from "../google/gmail";
import { createDriveDocument, createDriveFolder, readDriveFile, searchDriveFiles } from "../google/drive";
import { normalizeDriveContent, normalizeDriveName, normalizeDriveSearch, validDriveFileId } from "../drive-policy";
import { buildMemoryContext, recordManualMemoryFact } from "../memory";
import { authorizeAgentTool, type ZyronAgentToolName } from "./policy";
import { classifyAgentToolFailure } from "./tool-errors";
import { searchCurrentInformation } from "../current-search";
import { executeDeterministicCommand } from "../core/deterministic";
import { getZyronHealth } from "../health";
import { getWeatherForecast } from "../weather";

export type ZyronAgentToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
};

export const agentToolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "Lista las tareas pendientes reales de Aarón.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Crea una tarea persistente. Úsala cuando Aarón pida apuntar, recordar o registrar algo pendiente.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título limpio y concreto, máximo 240 caracteres." },
          due_at: { type: ["string", "null"], description: "Fecha ISO 8601 si se conoce con precisión; si no, null." },
        },
        required: ["title", "due_at"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Marca como completada una tarea existente cuando la referencia es inequívoca.",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Texto para localizar la tarea." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Elimina una única tarea existente solo después de mostrar cuál es y recibir confirmación expresa en un mensaje posterior.",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Texto inequívoco para localizar la tarea." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_daily_plan",
      description: "Ordena las tareas pendientes y devuelve un plan breve del día.",
      strict: true,
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 12 } },
        required: ["limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_operational_briefing",
      description: "Prepara bajo demanda un briefing verificable con agenda próxima, correos sin leer y tareas, sin usar otro modelo de IA.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_goals",
      description: "Lista los objetivos y proyectos reales de Aarón con su progreso de tareas.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_goal",
      description: "Crea un objetivo o proyecto persistente cuando Aarón lo pide explícitamente. No elimina ni reemplaza objetivos existentes.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre breve del objetivo o proyecto." },
          description: { type: ["string", "null"], description: "Descripción opcional y concreta." },
          icon: { type: ["string", "null"], description: "Un único emoji opcional." },
        },
        required: ["name", "description", "icon"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assign_task_to_goal",
      description: "Vincula una tarea existente con un objetivo existente cuando ambas referencias son inequívocas.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          task_query: { type: "string", description: "Nombre o referencia de la tarea." },
          goal_query: { type: "string", description: "Nombre o referencia del objetivo." },
        },
        required: ["task_query", "goal_query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_status",
      description: "Comprueba el estado real del núcleo, memoria, base de datos, proveedores y configuración esencial.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_actions",
      description: "Muestra acciones recientes realmente registradas por ZYRON para responder qué ha hecho o verificar una operación.",
      strict: true,
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 20 } },
        required: ["limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Recupera contexto de la memoria privada de ZYRON para una pregunta concreta.",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Consulta precisa de memoria." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Guarda una memoria permanente solo si Aarón lo ha pedido de forma explícita.",
      strict: true,
      parameters: {
        type: "object",
        properties: { fact: { type: "string", description: "Hecho o preferencia útil, sin texto accesorio." } },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_calendar",
      description: "Lee eventos reales del Google Calendar conectado.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["today", "tomorrow", "week", "next"] },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["range", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Crea un evento real en Google Calendar únicamente después de mostrar un resumen y recibir confirmación expresa en un mensaje posterior.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título concreto del evento." },
          start: { type: "string", description: "Inicio ISO 8601 con zona horaria cuando tenga hora." },
          end: { type: "string", description: "Fin ISO 8601 con zona horaria; debe ser posterior al inicio." },
          all_day: { type: "boolean", description: "true solo para eventos de día completo." },
          location: { type: ["string", "null"], description: "Ubicación si se conoce; si no, null." },
          description: { type: ["string", "null"], description: "Notas útiles si existen; si no, null." },
        },
        required: ["title", "start", "end", "all_day", "location", "description"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_events",
      description: "Crea de 2 a 10 eventos de Google Calendar como un único lote tras mostrar el resumen completo y recibir confirmación expresa. Úsala en vez de varias llamadas individuales.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          events: {
            type: "array",
            minItems: 2,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                start: { type: "string" },
                end: { type: "string" },
                all_day: { type: "boolean" },
                location: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
              },
              required: ["title", "start", "end", "all_day", "location", "description"],
              additionalProperties: false,
            },
          },
        },
        required: ["events"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_event",
      description: "Busca y elimina un único evento real de Google Calendar únicamente después de mostrar cuál es y recibir confirmación expresa en un mensaje posterior.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Título o referencia inequívoca del evento que se debe eliminar." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_places",
      description: "Busca lugares reales con Google Places. Para búsquedas cerca de Aarón usa las coordenadas compartidas en la conversación.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Qué lugar busca Aarón, incluyendo zona si no hay ubicación compartida." },
          latitude: { type: ["number", "null"], description: "Latitud compartida por el dispositivo; si no existe, null." },
          longitude: { type: ["number", "null"], description: "Longitud compartida por el dispositivo; si no existe, null." },
          limit: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["query", "latitude", "longitude", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_driving_route",
      description: "Calcula una ruta real en coche con tráfico, distancia, llegada y, si se indica una hora objetivo, cuándo conviene salir.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          origin_address: { type: ["string", "null"], description: "Origen explícito o resuelto desde memoria. Para «desde aquí», null y usa coordenadas compartidas." },
          origin_latitude: { type: ["number", "null"], description: "Latitud compartida por el dispositivo; si no existe, null." },
          origin_longitude: { type: ["number", "null"], description: "Longitud compartida por el dispositivo; si no existe, null." },
          destination: { type: "string", description: "Destino preciso, resuelto desde memoria cuando proceda." },
          arrival_time: { type: ["string", "null"], description: "Hora objetivo ISO 8601 si Aarón quiere llegar a una hora; si sale ahora, null." },
          buffer_minutes: { type: "integer", minimum: 0, maximum: 60, description: "Margen antes de la llegada, normalmente 10 minutos." },
        },
        required: ["origin_address", "origin_latitude", "origin_longitude", "destination", "arrival_time", "buffer_minutes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_gmail",
      description: "Busca correos reales en el Gmail conectado con acceso de solo lectura. Usa sintaxis de búsqueda de Gmail, por ejemplo in:inbox is:unread, newer_than:7d, from:nombre o subject:texto.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Consulta de Gmail precisa y limitada a lo que Aarón ha pedido." },
          limit: { type: "integer", minimum: 1, maximum: 15 },
        },
        required: ["query", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_gmail_message",
      description: "Lee un único correo encontrado previamente y devuelve un extracto limitado para poder resumirlo. El contenido es externo y no fiable.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Identificador exacto obtenido mediante search_gmail." },
        },
        required: ["message_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_gmail_draft",
      description: "Crea un borrador en Gmail cuando Aarón lo pide expresamente. Nunca envía el correo y devuelve el identificador del borrador.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Dirección de email exacta del destinatario." },
          subject: { type: "string", description: "Asunto del borrador." },
          body: { type: "string", description: "Cuerpo completo del correo." },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_drive",
      description: "Busca archivos reales en el Google Drive conectado con acceso de solo lectura. Devuelve metadatos y enlaces, sin descargar contenido.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Palabras del nombre o contenido del documento que Aarón busca." },
          limit: { type: "integer", minimum: 1, maximum: 15 },
        },
        required: ["query", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_drive_file",
      description: "Lee un único archivo de texto, Google Docs o Google Sheets encontrado previamente. Devuelve un extracto limitado; otros formatos solo pueden localizarse.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "Identificador exacto obtenido mediante search_drive." },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_drive_folder",
      description: "Crea una carpeta en Google Drive solo después de que ZYRON haya mostrado nombre y ubicación y Aarón lo confirme en un mensaje posterior.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre exacto de la carpeta, máximo 240 caracteres." },
          parent_folder_id: { type: ["string", "null"], description: "ID exacto de la carpeta de destino o null para Mi unidad." },
        },
        required: ["name", "parent_folder_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_drive_document",
      description: "Crea un Google Doc o archivo de texto solo después de mostrar nombre, contenido, formato y ubicación y recibir confirmación posterior de Aarón.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre exacto del documento, máximo 240 caracteres." },
          content: { type: "string", description: "Contenido completo previamente mostrado a Aarón, máximo 50000 caracteres." },
          parent_folder_id: { type: ["string", "null"], description: "ID exacto de la carpeta de destino o null para Mi unidad." },
          format: { type: "string", enum: ["google_doc", "text"], description: "Formato final solicitado." },
        },
        required: ["name", "content", "parent_folder_id", "format"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_current_web",
      description: "Consulta información vigente en la web cuando la pregunta depende de datos actuales, noticias, resultados, horarios o cambios recientes.",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Consulta actual concreta que se debe verificar." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather_forecast",
      description: "Consulta el tiempo actual y la previsión real de tres días para unas coordenadas autorizadas.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitud de la ubicación autorizada o solicitada." },
          longitude: { type: "number", description: "Longitud de la ubicación autorizada o solicitada." },
        },
        required: ["latitude", "longitude"],
        additionalProperties: false,
      },
    },
  },
];

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function textArgument(args: Record<string, unknown>, key: string, max = 500) {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  return value.slice(0, max);
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function madridDateKey(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

function tomorrowKey(todayKey: string) {
  const [year, month, day] = todayKey.split("-").map(Number);
  return madridDateKey(new Date(Date.UTC(year, month - 1, day + 1, 12)));
}

async function audit(action: string, summary: string, metadata: Record<string, unknown> = {}) {
  try {
    await recordAction("agent", action, summary, metadata);
  } catch (error) {
    console.error("ZYRON_AGENT_AUDIT_ERROR", error);
  }
}

async function readCalendar(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const allowedRanges = new Set(["today", "tomorrow", "week", "next"]);
  const range = typeof args.range === "string" && allowedRanges.has(args.range) ? args.range : "week";
  const limit = Math.max(1, Math.min(Number(args.limit) || 8, 20));
  const now = new Date();
  const events = await listCalendarEvents({
    timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    timeMax: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
    maxResults: 50,
  });
  const today = madridDateKey(now);
  const tomorrow = tomorrowKey(today);
  let selected = events.filter((event) => event.allDay || new Date(event.end).getTime() >= now.getTime());
  if (range === "today") selected = selected.filter((event) => madridDateKey(event.start) === today);
  if (range === "tomorrow") selected = selected.filter((event) => madridDateKey(event.start) === tomorrow);
  if (range === "next") selected = selected.slice(0, 1);
  selected = selected.slice(0, limit);

  const data = selected.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location || null,
  }));
  await audit("calendar_read", `Consultó el calendario (${range}) y obtuvo ${data.length} eventos.`, { range, count: data.length });
  return { ok: true, summary: `Calendario consultado: ${data.length} eventos.`, data };
}

function calendarEventArguments(args: Record<string, unknown>) {
  const title = textArgument(args, "title", 240).replace(/[.!?]+$/, "");
  const start = textArgument(args, "start", 80);
  const end = textArgument(args, "end", 80);
  const allDay = args.all_day === true;
  const location = textArgument(args, "location", 500) || null;
  const description = textArgument(args, "description", 2_000) || null;
  if (!title || !start || !end) throw new Error("calendar_event_fields_required");
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
      throw new Error("calendar_all_day_range_invalid");
    }
  } else {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      throw new Error("calendar_time_range_invalid");
    }
  }
  return { title, start, end, allDay, location, description, timeZone: "Europe/Madrid" };
}

async function createAgentCalendarEvent(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const event = await createCalendarEvent(calendarEventArguments(args));
  await audit("calendar_event_created", `Creó el evento “${event.title}”.`, {
    eventId: event.id,
    start: event.start,
    end: event.end,
    location: event.location,
  });
  return { ok: true, summary: `Evento creado: ${event.title}.`, data: event };
}

async function createAgentCalendarEvents(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const rawEvents = Array.isArray(args.events) ? args.events : [];
  if (rawEvents.length < 2 || rawEvents.length > 10) {
    return { ok: false, summary: "El lote debe contener entre 2 y 10 eventos." };
  }
  const events = rawEvents.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("calendar_event_fields_required");
    return calendarEventArguments(item as Record<string, unknown>);
  });
  const created: Awaited<ReturnType<typeof createCalendarEvent>>[] = [];
  try {
    for (const event of events) created.push(await createCalendarEvent(event));
  } catch (error) {
    const rollback = await Promise.allSettled(created.map((event) => deleteCalendarEvent(event.id)));
    const rollbackFailed = rollback.some((result) => result.status === "rejected");
    await audit("calendar_batch_failed", "Falló la creación de un lote de eventos y se ejecutó la reversión.", {
      requested: events.length,
      createdBeforeFailure: created.length,
      rollbackFailed,
    });
    if (rollbackFailed) {
      return {
        ok: false,
        summary: "La creación del lote falló y no se han podido revertir todos los eventos. Revisa el calendario antes de repetir la orden.",
        data: { created: created.map((event) => ({ id: event.id, title: event.title })) },
      };
    }
    throw error;
  }
  await audit("calendar_events_created", `Creó ${created.length} eventos de calendario en un lote confirmado.`, {
    eventIds: created.map((event) => event.id),
  });
  return {
    ok: true,
    summary: `${created.length} eventos creados correctamente.`,
    data: created,
  };
}

async function deleteAgentCalendarEvent(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const query = textArgument(args, "query", 240);
  if (!query) return { ok: false, summary: "Falta identificar el evento." };
  const needle = normalized(query);
  const now = new Date();
  const events = await listCalendarEvents({
    timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    timeMax: new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000),
    maxResults: 100,
  });
  const matches = events.filter((event) => {
    const title = normalized(event.title);
    return title.includes(needle) || needle.includes(title);
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      summary: matches.length ? "Hay varios eventos compatibles; Aarón debe concretar cuál." : "No se ha encontrado un evento compatible.",
      data: matches.slice(0, 8).map((event) => ({ title: event.title, start: event.start })),
    };
  }
  await deleteCalendarEvent(matches[0].id);
  await audit("calendar_event_deleted", `Eliminó el evento “${matches[0].title}”.`, {
    eventId: matches[0].id,
    start: matches[0].start,
  });
  return { ok: true, summary: `Evento eliminado: ${matches[0].title}.`, data: matches[0] };
}

async function searchAgentPlaces(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const query = textArgument(args, "query", 300);
  if (!query) return { ok: false, summary: "Falta indicar qué lugar hay que buscar." };
  const latitude = args.latitude;
  const longitude = args.longitude;
  const coordinates = sharedCoordinates(latitude, longitude);
  const hasAnyCoordinate = latitude !== null || longitude !== null;
  if (hasAnyCoordinate && !coordinates) {
    return { ok: false, summary: "Para buscar cerca de ti necesito que compartas una ubicación válida desde Telegram." };
  }
  const limit = Math.max(1, Math.min(Number(args.limit) || 5, 5));
  const places = await searchPlacesText({
    query,
    ...(coordinates ?? {}),
    pageSize: limit,
  });
  await audit("places_searched", `Buscó lugares y obtuvo ${places.length} resultados.`, {
    count: places.length,
    locationBiased: Boolean(coordinates),
  });
  return { ok: true, summary: `${places.length} lugares encontrados.`, data: places };
}

function sharedCoordinates(latitude: unknown, longitude: unknown) {
  return validSharedLocation(latitude, longitude)
    ? { latitude: latitude as number, longitude: longitude as number }
    : null;
}

function routeOrigin(args: Record<string, unknown>): RoutePoint | null {
  const address = textArgument(args, "origin_address", 300);
  if (address) return { address };
  return sharedCoordinates(args.origin_latitude, args.origin_longitude);
}

async function getAgentDrivingRoute(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const origin = routeOrigin(args);
  if (!origin) {
    return { ok: false, summary: "Necesito un origen concreto. Si quieres salir desde donde estás, comparte primero tu ubicación por Telegram." };
  }
  const destination = textArgument(args, "destination", 300);
  if (!destination) return { ok: false, summary: "Falta un destino concreto." };
  const arrivalCandidate = textArgument(args, "arrival_time", 80);
  const arrivalTime = arrivalCandidate ? new Date(arrivalCandidate) : null;
  if (arrivalTime && (!Number.isFinite(arrivalTime.getTime()) || arrivalTime.getTime() <= Date.now())) {
    return { ok: false, summary: "La hora prevista de llegada no es válida o ya ha pasado." };
  }
  const bufferMinutes = Math.max(0, Math.min(Number(args.buffer_minutes) || 0, 60));
  let planned: Awaited<ReturnType<typeof planDepartureForArrival>> | null = null;
  const estimate = arrivalTime
    ? (planned = await planDepartureForArrival({ origin, destination: { address: destination }, arrivalTime, bufferMinutes }))
    : await computeDrivingRoute({ origin, destination: { address: destination } });
  const data = {
    durationMinutes: Math.max(1, Math.round(estimate.durationSeconds / 60)),
    distanceKilometers: Math.round((estimate.distanceMeters / 1000) * 10) / 10,
    departureTime: estimate.departureTime,
    arrivalTime: estimate.arrivalTime,
    trafficDelayMinutes: estimate.trafficDelaySeconds === null ? null : Math.round(estimate.trafficDelaySeconds / 60),
    ...(planned ? {
      recommendedDepartureTime: planned.recommendedDepartureTime,
      targetArrivalTime: planned.targetArrivalTime,
      bufferMinutes: planned.bufferMinutes,
    } : {}),
    navigation: buildNavigationLinks(origin, destination),
  };
  await audit("driving_route_calculated", "Calculó una ruta en coche con tráfico real.", {
    originMode: "address" in origin ? "address" : "shared_location",
    arriveBy: Boolean(arrivalTime),
    durationMinutes: data.durationMinutes,
    distanceKilometers: data.distanceKilometers,
  });
  return { ok: true, summary: `Ruta calculada: ${data.durationMinutes} min y ${data.distanceKilometers} km.`, data };
}

async function searchAgentGmail(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const query = normalizeGmailQuery(args.query);
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 15));
  const messages = await listGmailMessages(query, limit);
  const data = messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    from: compactSender(message.from),
    snippet: message.snippet,
    unread: message.unread,
    starred: message.starred,
    important: message.important,
    receivedAt: message.internalDate,
    contentTrust: "untrusted_email" as const,
  }));
  await audit("gmail_searched", `Consultó Gmail y obtuvo ${data.length} mensajes.`, { count: data.length });
  return {
    ok: true,
    summary: `${data.length} correos encontrados.`,
    data: { messages: data, privacy: "Contenido temporal de solo lectura; no se guarda en memoria permanente." },
  };
}

async function readAgentGmailMessage(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const messageId = args.message_id;
  if (!validGmailMessageId(messageId)) return { ok: false, summary: "El identificador del correo no es válido." };
  const message = await readGmailMessage(messageId);
  await audit("gmail_message_read", "Leyó un correo concreto para responder a una petición del propietario.", {});
  return {
    ok: true,
    summary: "Correo leído en modo privado y de solo lectura.",
    data: {
      id: message.id,
      subject: message.subject,
      from: compactSender(message.from),
      receivedAt: message.internalDate,
      bodyExcerpt: message.bodyExcerpt,
      contentTrust: message.contentTrust,
      privacy: "Extracto temporal limitado; no se guarda en memoria permanente.",
    },
  };
}

async function searchAgentDrive(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const query = normalizeDriveSearch(args.query);
  if (!query) return { ok: false, summary: "Indica qué documento o archivo quieres buscar en Drive." };
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 15));
  const files = await searchDriveFiles(query, limit);
  await audit("drive_searched", `Consultó Google Drive y obtuvo ${files.length} archivos.`, { count: files.length });
  return {
    ok: true,
    summary: `${files.length} archivos encontrados en Drive.`,
    data: {
      files: files.map((file) => ({ ...file, contentTrust: "untrusted_drive_metadata" as const })),
      privacy: "Metadatos temporales de solo lectura; no se guardan en memoria permanente.",
    },
  };
}

async function readAgentDriveFile(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const fileId = args.file_id;
  if (!validDriveFileId(fileId)) return { ok: false, summary: "El identificador del archivo no es válido." };
  const file = await readDriveFile(fileId);
  await audit("drive_file_read", "Leyó un archivo concreto de Drive para responder al propietario.", {});
  return {
    ok: true,
    summary: "Archivo leído en modo privado y de solo lectura.",
    data: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      textExcerpt: file.textExcerpt,
      truncated: file.truncated,
      contentTrust: file.contentTrust,
      privacy: "Extracto temporal limitado; no se guarda en memoria permanente.",
    },
  };
}

function driveParent(args: Record<string, unknown>) {
  const value = args.parent_folder_id;
  if (value === null || value === undefined || value === "") return null;
  return validDriveFileId(value) ? value : undefined;
}

async function createAgentDriveFolder(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const name = normalizeDriveName(args.name);
  const parentFolderId = driveParent(args);
  if (!name) return { ok: false, summary: "Indica un nombre válido para la carpeta." };
  if (parentFolderId === undefined) return { ok: false, summary: "La carpeta de destino no es válida; vuelve a localizarla antes de confirmar." };
  const folder = await createDriveFolder(name, parentFolderId);
  await audit("drive_folder_created", "Creó una carpeta en Drive tras confirmación explícita del propietario.", { destination: parentFolderId ? "selected_folder" : "my_drive" });
  return {
    ok: true,
    summary: `Carpeta creada en Drive: ${folder.name}.`,
    data: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink, destination: parentFolderId ? "selected_folder" : "my_drive" },
  };
}

async function createAgentDriveDocument(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const name = normalizeDriveName(args.name);
  const content = normalizeDriveContent(args.content);
  const parentFolderId = driveParent(args);
  const format = args.format === "text" ? "text" : args.format === "google_doc" ? "google_doc" : null;
  if (!name) return { ok: false, summary: "Indica un nombre válido para el documento." };
  if (!content) return { ok: false, summary: "El documento está vacío; muestra primero el contenido que se guardará." };
  if (!format) return { ok: false, summary: "El formato debe ser Google Doc o texto." };
  if (parentFolderId === undefined) return { ok: false, summary: "La carpeta de destino no es válida; vuelve a localizarla antes de confirmar." };
  const document = await createDriveDocument({ name, content, parentFolderId, format });
  await audit("drive_document_created", "Creó un documento en Drive tras confirmación explícita del propietario.", { format, destination: parentFolderId ? "selected_folder" : "my_drive" });
  return {
    ok: true,
    summary: `Documento creado en Drive: ${document.name}.`,
    data: { id: document.id, name: document.name, mimeType: document.mimeType, webViewLink: document.webViewLink, destination: parentFolderId ? "selected_folder" : "my_drive" },
  };
}

export async function executeAgentTool(input: {
  name: string;
  arguments: string;
  userMessage: string;
}): Promise<ZyronAgentToolResult> {
  const authorization = authorizeAgentTool(input.name, input.userMessage);
  if (!authorization.allowed) return { ok: false, summary: authorization.reason };
  const name = input.name as ZyronAgentToolName;
  const args = parseArguments(input.arguments);

  try {
    if (name === "list_tasks") {
      const tasks = (await listTasks()).filter((task) => !task.completed).slice(0, 30);
      await audit("tasks_listed", `Consultó ${tasks.length} tareas pendientes.`, { count: tasks.length });
      return { ok: true, summary: `${tasks.length} tareas pendientes.`, data: tasks };
    }

    if (name === "create_task") {
      const title = textArgument(args, "title", 240).replace(/[.!?]+$/, "");
      if (!title) return { ok: false, summary: "Falta un título válido para la tarea." };
      const dueCandidate = typeof args.due_at === "string" ? args.due_at : null;
      const dueAt = dueCandidate && Number.isFinite(new Date(dueCandidate).getTime()) ? new Date(dueCandidate).toISOString() : null;
      const task = await createTask(title, dueAt);
      await audit("task_created", `Creó la tarea “${task.title}”.`, { taskId: task.id, dueAt: task.due_at });
      return { ok: true, summary: `Tarea creada: ${task.title}.`, data: task };
    }

    if (name === "complete_task") {
      const query = textArgument(args, "query", 240);
      if (!query) return { ok: false, summary: "Falta identificar la tarea." };
      const needle = normalized(query);
      const matches = (await listTasks()).filter((task) => !task.completed)
        .filter((task) => normalized(task.title).includes(needle) || needle.includes(normalized(task.title)));
      if (matches.length !== 1) {
        return {
          ok: false,
          summary: matches.length ? "Hay varias tareas compatibles; Aarón debe elegir una." : "No se ha encontrado una tarea compatible.",
          data: matches.slice(0, 6).map((task) => ({ id: task.id, title: task.title })),
        };
      }
      const task = await setTaskCompleted(matches[0].id, true);
      await audit("task_completed", `Completó la tarea “${matches[0].title}”.`, { taskId: matches[0].id });
      return { ok: true, summary: `Tarea completada: ${matches[0].title}.`, data: task };
    }

    if (name === "delete_task") {
      const query = textArgument(args, "query", 240);
      if (!query) return { ok: false, summary: "Falta identificar la tarea." };
      const needle = normalized(query);
      const matches = (await listTasks()).filter((task) => !task.completed)
        .filter((task) => normalized(task.title).includes(needle) || needle.includes(normalized(task.title)));
      if (matches.length !== 1) {
        return {
          ok: false,
          summary: matches.length ? "Hay varias tareas compatibles; Aarón debe elegir una." : "No se ha encontrado una tarea compatible.",
          data: matches.slice(0, 6).map((task) => ({ id: task.id, title: task.title })),
        };
      }
      const removed = await deleteTask(matches[0].id);
      if (!removed) return { ok: false, summary: "La tarea ya no existe o no se ha podido eliminar." };
      await audit("task_deleted", `Eliminó la tarea “${matches[0].title}” tras confirmación.`, { taskId: matches[0].id });
      return { ok: true, summary: `Tarea eliminada: ${matches[0].title}.`, data: { id: matches[0].id, title: matches[0].title } };
    }

    if (name === "build_daily_plan") {
      const limit = Math.max(1, Math.min(Number(args.limit) || 6, 12));
      const plan = await buildDailyPlan(limit);
      return { ok: true, summary: formatDailyPlan(plan), data: plan };
    }

    if (name === "get_operational_briefing") {
      const briefing = await executeDeterministicCommand({ type: "briefing" });
      return { ok: true, summary: briefing.reply, data: { creditsUsed: false } };
    }

    if (name === "list_goals") {
      const goals = await listGoals();
      await audit("goals_listed", `Consultó ${goals.length} objetivos.`, { count: goals.length });
      return { ok: true, summary: `${goals.length} objetivos encontrados.`, data: goals };
    }

    if (name === "create_goal") {
      const goalName = textArgument(args, "name", 100).replace(/[.!?]+$/, "");
      const description = textArgument(args, "description", 1_000) || null;
      const iconCandidate = textArgument(args, "icon", 16);
      if (!goalName) return { ok: false, summary: "Falta un nombre válido para el objetivo." };
      const slug = normalized(goalName).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      if (!slug) return { ok: false, summary: "No se ha podido generar un identificador válido para el objetivo." };
      const goal = await createGoal(goalName, slug, iconCandidate || "🎯", description);
      await audit("goal_created", `Creó el objetivo “${goal.name}”.`, { goalId: goal.id });
      return { ok: true, summary: `Objetivo creado: ${goal.name}.`, data: goal };
    }

    if (name === "assign_task_to_goal") {
      const taskQuery = textArgument(args, "task_query", 240);
      const goalQuery = textArgument(args, "goal_query", 100);
      if (!taskQuery || !goalQuery) return { ok: false, summary: "Falta identificar la tarea o el objetivo." };
      const taskNeedle = normalized(taskQuery);
      const goalNeedle = normalized(goalQuery);
      const taskMatches = (await listTasks()).filter((task) => !task.completed)
        .filter((task) => normalized(task.title).includes(taskNeedle) || taskNeedle.includes(normalized(task.title)));
      const goalMatches = (await listGoals()).filter((goal) => goal.active)
        .filter((goal) => normalized(goal.name).includes(goalNeedle) || goalNeedle.includes(normalized(goal.name)) || goal.slug === goalNeedle);
      if (taskMatches.length !== 1 || goalMatches.length !== 1) {
        return {
          ok: false,
          summary: taskMatches.length !== 1 ? "La tarea no es inequívoca." : "El objetivo no es inequívoco.",
          data: {
            tasks: taskMatches.slice(0, 6).map((task) => ({ id: task.id, title: task.title })),
            goals: goalMatches.slice(0, 6).map((goal) => ({ id: goal.id, name: goal.name })),
          },
        };
      }
      const task = await assignTaskToGoal(taskMatches[0].id, goalMatches[0].id);
      await audit("task_goal_assigned", `Vinculó “${taskMatches[0].title}” con “${goalMatches[0].name}”.`, {
        taskId: taskMatches[0].id,
        goalId: goalMatches[0].id,
      });
      return { ok: true, summary: `Tarea vinculada al objetivo ${goalMatches[0].name}.`, data: task };
    }

    if (name === "get_system_status") {
      const health = await getZyronHealth();
      const data = {
        ok: health.ok,
        version: health.version,
        checks: Object.fromEntries(Object.entries(health.checks).map(([key, check]) => [key, {
          configured: check.configured,
          reachable: check.reachable,
          latencyMs: check.latencyMs,
        }])),
      };
      return { ok: true, summary: health.ok ? "El núcleo de ZYRON está operativo." : "El núcleo de ZYRON tiene servicios que requieren revisión.", data };
    }

    if (name === "list_recent_actions") {
      const limit = Math.max(1, Math.min(Number(args.limit) || 8, 20));
      const actions = await listActions(limit);
      return {
        ok: true,
        summary: `${actions.length} acciones verificadas recuperadas.`,
        data: actions.map((action) => ({ action: action.action, summary: action.summary, createdAt: action.created_at })),
      };
    }

    if (name === "search_memory") {
      const query = textArgument(args, "query", 500) || input.userMessage;
      const memory = await buildMemoryContext(query, 12_000);
      return {
        ok: true,
        summary: `Memoria recuperada: ${memory.blocks.length} bloques relevantes.`,
        data: { context: memory.context, blocks: memory.blocks.map((block) => ({ id: block.id, section: block.section_path })) },
      };
    }

    if (name === "remember_fact") {
      const fact = textArgument(args, "fact", 2_000).replace(/[.!?]+$/, "");
      if (!fact) return { ok: false, summary: "La memoria propuesta está vacía." };
      const block = await recordManualMemoryFact(fact, { source: "zyron-agent-v0.22" });
      await audit("memory_saved", "Guardó una memoria solicitada explícitamente por el propietario.", { memoryBlockId: block.id });
      return { ok: true, summary: `Memoria guardada: ${fact}.`, data: { id: block.id } };
    }

    if (name === "read_calendar") return await readCalendar(args);
    if (name === "create_calendar_event") return await createAgentCalendarEvent(args);
    if (name === "create_calendar_events") return await createAgentCalendarEvents(args);
    if (name === "delete_calendar_event") return await deleteAgentCalendarEvent(args);
    if (name === "search_places") return await searchAgentPlaces(args);
    if (name === "get_driving_route") return await getAgentDrivingRoute(args);
    if (name === "search_gmail") return await searchAgentGmail(args);
    if (name === "read_gmail_message") return await readAgentGmailMessage(args);
    if (name === "create_gmail_draft") {
      const to = textArgument(args, "to", 320);
      const subject = textArgument(args, "subject", 500);
      const body = textArgument(args, "body", 50_000);
      if (!to || !subject || !body) return { ok: false, summary: "Faltan destinatario, asunto o contenido del borrador." };
      const draft = await createGmailDraft({ to, subject, body });
      await audit("gmail_draft_created", "Creó un borrador de Gmail solicitado por el propietario.", { draftId: draft.id, recipient: to });
      return { ok: true, summary: `Borrador creado en Gmail para ${to}. No se ha enviado.`, data: draft };
    }
    if (name === "search_drive") return await searchAgentDrive(args);
    if (name === "read_drive_file") return await readAgentDriveFile(args);
    if (name === "create_drive_folder") return await createAgentDriveFolder(args);
    if (name === "create_drive_document") return await createAgentDriveDocument(args);
    if (name === "get_weather_forecast") {
      const latitude = Number(args.latitude);
      const longitude = Number(args.longitude);
      if (!validSharedLocation(latitude, longitude)) return { ok: false, summary: "Falta una ubicación válida para consultar el tiempo." };
      const forecast = await getWeatherForecast(latitude, longitude);
      await audit("weather_forecast_read", "Consultó la previsión meteorológica contextual.", { source: forecast.source });
      return { ok: true, summary: "Previsión meteorológica actualizada.", data: forecast };
    }
    if (name === "search_current_web") {
      const query = textArgument(args, "query", 1_000);
      if (!query) return { ok: false, summary: "Falta una consulta actual concreta." };
      const result = await searchCurrentInformation(query);
      await audit("current_information_searched", "Consultó información vigente en la web.", { model: result.model });
      return { ok: true, summary: "Información actual verificada en la web.", data: { reply: result.reply } };
    }
    return { ok: false, summary: "Herramienta no implementada." };
  } catch (error) {
    console.error("ZYRON_AGENT_TOOL_ERROR", name, error);
    const failure = classifyAgentToolFailure(name, error);
    return { ok: false, summary: failure.summary, data: { code: failure.code } };
  }
}
