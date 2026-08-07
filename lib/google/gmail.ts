import OpenAI from "openai";
import {
  connectionHasScope,
  getGoogleAccessToken,
  getGoogleConnection,
  GMAIL_READONLY_SCOPE,
} from "./oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string | null;
  snippet: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  internalDate: string | null;
};

export type GmailPriority = {
  id: string;
  priority: "alta" | "media" | "baja";
  reason: string;
  summary: string;
};

type GmailHeader = { name: string; value: string };
type GmailListResponse = { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};
type GmailLabelResponse = { messagesUnread?: number };

function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function compactSender(value: string | null) {
  if (!value) return "Remitente desconocido";
  return value.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "").trim() || value;
}

async function gmailFetch<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`gmail_api_${response.status}${detail ? `:${detail.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export async function assertGmailReady() {
  const connection = await getGoogleConnection();
  if (!connection) throw new Error("google_not_connected");
  if (!connectionHasScope(connection.scope, GMAIL_READONLY_SCOPE)) throw new Error("gmail_scope_missing");
  return connection;
}

export async function getInboxUnreadCount(): Promise<number> {
  await assertGmailReady();
  const accessToken = await getGoogleAccessToken();
  const label = await gmailFetch<GmailLabelResponse>("/labels/INBOX", accessToken);
  return Math.max(0, Number(label.messagesUnread ?? 0));
}

export async function listGmailMessages(query: string, maxResults = 15): Promise<GmailMessage[]> {
  await assertGmailReady();
  const accessToken = await getGoogleAccessToken();
  const params = new URLSearchParams({ q: query, maxResults: String(Math.max(1, Math.min(50, maxResults))) });
  const listed = await gmailFetch<GmailListResponse>(`/messages?${params.toString()}`, accessToken);
  const refs = listed.messages ?? [];

  return Promise.all(refs.map(async (ref) => {
    const metadata = new URLSearchParams({ format: "metadata" });
    ["Subject", "From", "Date"].forEach((name) => metadata.append("metadataHeaders", name));
    const message = await gmailFetch<GmailMessageResponse>(`/messages/${encodeURIComponent(ref.id)}?${metadata.toString()}`, accessToken);
    const labels = message.labelIds ?? [];
    return {
      id: message.id,
      threadId: message.threadId,
      subject: header(message.payload?.headers, "Subject") || "(Sin asunto)",
      from: header(message.payload?.headers, "From"),
      snippet: (message.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
      unread: labels.includes("UNREAD"),
      starred: labels.includes("STARRED"),
      important: labels.includes("IMPORTANT"),
      internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    };
  }));
}

function fallbackPriority(messages: GmailMessage[]): GmailPriority[] {
  return messages.map((message) => {
    const score = (message.important ? 3 : 0) + (message.starred ? 2 : 0) + (message.unread ? 1 : 0);
    const priority = score >= 4 ? "alta" : score >= 1 ? "media" : "baja";
    let reason: string;
    if (message.important || message.starred) {
      reason = "Gmail lo ha marcado como importante o destacado. Acción sugerida: abre el correo y comprueba si requiere respuesta o una tarea concreta.";
    } else if (message.unread) {
      reason = "Está sin leer. Acción sugerida: revísalo cuando limpies los correos recientes; no hay señal suficiente para una acción más específica.";
    } else {
      reason = "No tiene señales claras de urgencia. Acción sugerida: no necesita atención inmediata.";
    }
    return {
      id: message.id,
      priority,
      reason,
      summary: message.snippet || message.subject,
    };
  });
}

export async function prioritizeGmailMessages(messages: GmailMessage[]): Promise<GmailPriority[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || messages.length === 0) return fallbackPriority(messages);
  const openai = new OpenAI({ apiKey });

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Eres el clasificador privado de correo de ZYRON.",
        "Prioriza únicamente con los datos recibidos. No inventes contexto, obligaciones ni urgencias.",
        "Alta: requiere atención pronta, respuesta, una acción, un plazo, una incidencia, dinero, seguridad o alguien claramente esperando algo.",
        "Media: relevante y conviene revisarlo, pero sin urgencia clara.",
        "Baja: publicidad, automatismos, newsletters o información sin acción probable.",
        "Para cada correo debes proponer también el siguiente paso más útil, pero solo si se puede deducir razonablemente del remitente, asunto o fragmento.",
        "No afirmes que una acción se ha ejecutado. ZYRON aquí solo recomienda; no envía, borra, archiva ni modifica Gmail.",
        "En el campo reason usa exactamente dos partes breves: 'Motivo: ... Acción sugerida: ...'. Si no se puede saber qué hacer, indica 'Acción sugerida: revisar el correo antes de decidir'.",
        "Devuelve exclusivamente JSON válido con forma {\"items\":[{\"id\":\"...\",\"priority\":\"alta|media|baja\",\"reason\":\"Motivo: ... Acción sugerida: ...\",\"summary\":\"...\"}]}",
        "reason y summary deben ser breves y en castellano de España.",
      ].join("\n"),
      input: JSON.stringify(messages.map((message) => ({
        id: message.id,
        from: compactSender(message.from),
        subject: message.subject,
        snippet: message.snippet,
        unread: message.unread,
        starred: message.starred,
        important: message.important,
        date: message.internalDate,
      }))),
    });
    const parsed = JSON.parse(response.output_text.trim()) as { items?: GmailPriority[] };
    const valid = (parsed.items ?? []).filter((item) =>
      item && typeof item.id === "string" && ["alta", "media", "baja"].includes(item.priority),
    );
    return valid.length ? valid : fallbackPriority(messages);
  } catch {
    return fallbackPriority(messages);
  }
}
