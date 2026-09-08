import OpenAI from "openai";
import {
  connectionHasScope,
  getGoogleAccessToken,
  getGoogleConnection,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
} from "./oauth.ts";

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

export type GmailMessageContent = GmailMessage & {
  bodyExcerpt: string;
  contentTrust: "untrusted_email";
};

type GmailHeader = { name: string; value: string };
type GmailListResponse = { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};
type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailLabelResponse = { messagesUnread?: number };

function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodedBody(data: string | undefined) {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function plainTextFromHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function collectBodyParts(part: GmailPart | undefined, plain: string[], html: string[]) {
  if (!part) return;
  const value = decodedBody(part.body?.data);
  if (value && part.mimeType === "text/plain") plain.push(value);
  if (value && part.mimeType === "text/html") html.push(plainTextFromHtml(value));
  for (const child of part.parts ?? []) collectBodyParts(child, plain, html);
}

function cleanBodyExcerpt(payload: GmailPart | undefined, fallback: string) {
  const plain: string[] = [];
  const html: string[] = [];
  collectBodyParts(payload, plain, html);
  return (plain.join("\n") || html.join("\n") || fallback)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6_000);
}

function mappedMessage(message: GmailMessageResponse): GmailMessage {
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
}

export function compactSender(value: string | null) {
  if (!value) return "Remitente desconocido";
  return value.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "").trim() || value;
}

async function gmailFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`gmail_api_${response.status}${detail ? `:${detail.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export function buildGmailDraftRaw(input: { to: string; subject: string; body: string }) {
  if (/[\r\n]/.test(input.to)) throw new Error("gmail_invalid_recipient");
  const to = input.to.trim().slice(0, 320);
  const subject = input.subject.replace(/[\r\n]/g, " ").trim().slice(0, 500);
  const body = input.body.replace(/\r\n?/g, "\n").trim().slice(0, 50_000);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error("gmail_invalid_recipient");
  if (!subject || !body) throw new Error("gmail_draft_incomplete");
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  return [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

export async function createGmailDraft(input: { to: string; subject: string; body: string }) {
  const connection = await getGoogleConnection();
  if (!connection) throw new Error("google_not_connected");
  if (!connectionHasScope(connection.scope, GMAIL_COMPOSE_SCOPE)) throw new Error("gmail_compose_scope_missing");
  const accessToken = await getGoogleAccessToken();
  const raw = Buffer.from(buildGmailDraftRaw(input), "utf8").toString("base64url");
  const draft = await gmailFetch<{ id: string; message?: { id?: string; threadId?: string } }>("/drafts", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  return { id: draft.id, messageId: draft.message?.id ?? null, threadId: draft.message?.threadId ?? null };
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
    return mappedMessage(message);
  }));
}

export async function readGmailMessage(messageId: string): Promise<GmailMessageContent> {
  await assertGmailReady();
  const accessToken = await getGoogleAccessToken();
  const message = await gmailFetch<GmailMessageResponse>(
    `/messages/${encodeURIComponent(messageId)}?format=full`,
    accessToken,
  );
  const metadata = mappedMessage(message);
  return {
    ...metadata,
    bodyExcerpt: cleanBodyExcerpt(message.payload, metadata.snippet),
    contentTrust: "untrusted_email",
  };
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
