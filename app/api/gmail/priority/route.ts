import OpenAI from "openai";
import { NextResponse } from "next/server";
import { recordAction } from "../../../../lib/db";
import {
  connectionHasScope,
  getGoogleAccessToken,
  getGoogleConnection,
  GMAIL_READONLY_SCOPE,
} from "../../../../lib/google/oauth";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const QUERY = "in:inbox newer_than:3d";
const MAX_RESULTS = 20;

type GmailHeader = { name: string; value: string };
type GmailListResponse = { messages?: Array<{ id: string; threadId: string }> };
type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};
type MailItem = {
  id: string;
  from: string | null;
  subject: string;
  snippet: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  internalDate: string | null;
};
type PriorityItem = {
  id: string;
  priority: "alta" | "media" | "baja";
  reason: string;
  summary: string;
};

function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function compactSender(value: string | null) {
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
    throw new Error(`gmail_api_${response.status}${detail ? `:${detail.slice(0, 160)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function loadMail(): Promise<MailItem[]> {
  const accessToken = await getGoogleAccessToken();
  const query = new URLSearchParams({ q: QUERY, maxResults: String(MAX_RESULTS) });
  const listed = await gmailFetch<GmailListResponse>(`/messages?${query.toString()}`, accessToken);
  const refs = listed.messages ?? [];

  return Promise.all(refs.map(async (ref) => {
    const metadata = new URLSearchParams({ format: "metadata" });
    ["Subject", "From", "Date"].forEach((name) => metadata.append("metadataHeaders", name));
    const message = await gmailFetch<GmailMessageResponse>(`/messages/${encodeURIComponent(ref.id)}?${metadata.toString()}`, accessToken);
    const labels = message.labelIds ?? [];
    return {
      id: message.id,
      from: header(message.payload?.headers, "From"),
      subject: header(message.payload?.headers, "Subject") || "(Sin asunto)",
      snippet: (message.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
      unread: labels.includes("UNREAD"),
      starred: labels.includes("STARRED"),
      important: labels.includes("IMPORTANT"),
      internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    };
  }));
}

function fallbackPriority(messages: MailItem[]): PriorityItem[] {
  return messages.map((message) => {
    const score = (message.important ? 3 : 0) + (message.starred ? 2 : 0) + (message.unread ? 1 : 0);
    return {
      id: message.id,
      priority: score >= 4 ? "alta" : score >= 1 ? "media" : "baja",
      reason: message.important || message.starred
        ? "Gmail lo ha marcado como importante o destacado."
        : message.unread
          ? "Está sin leer."
          : "No tiene señales claras de urgencia.",
      summary: message.snippet || message.subject,
    };
  });
}

async function classify(messages: MailItem[]): Promise<PriorityItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || messages.length === 0) return fallbackPriority(messages);
  const openai = new OpenAI({ apiKey });

  try {
    const input = messages.map((message) => ({
      id: message.id,
      from: compactSender(message.from),
      subject: message.subject,
      snippet: message.snippet,
      unread: message.unread,
      starred: message.starred,
      important: message.important,
      date: message.internalDate,
    }));
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Eres el clasificador privado de correo de ZYRON.",
        "Prioriza solo con la información recibida. No inventes contexto ni obligaciones.",
        "Alta: requiere atención pronta, acción, respuesta, plazo, incidencia, dinero, seguridad o una persona claramente esperando algo.",
        "Media: relevante pero sin urgencia clara. Baja: publicidad, automatismos o información sin acción probable.",
        "Devuelve exclusivamente JSON válido con forma {\"items\":[{\"id\":\"...\",\"priority\":\"alta|media|baja\",\"reason\":\"...\",\"summary\":\"...\"}]}.",
        "reason y summary deben ser breves y estar en castellano de España.",
      ].join("\n"),
      input: JSON.stringify(input),
    });
    const parsed = JSON.parse(response.output_text.trim()) as { items?: PriorityItem[] };
    if (!Array.isArray(parsed.items)) return fallbackPriority(messages);
    const valid = parsed.items.filter((item) =>
      item && typeof item.id === "string" && ["alta", "media", "baja"].includes(item.priority),
    );
    return valid.length ? valid : fallbackPriority(messages);
  } catch {
    return fallbackPriority(messages);
  }
}

export async function GET() {
  try {
    const connection = await getGoogleConnection();
    if (!connection) {
      return NextResponse.json({ error: "google_not_connected", reauthorize: true }, { status: 401 });
    }
    if (!connectionHasScope(connection.scope, GMAIL_READONLY_SCOPE)) {
      return NextResponse.json({ error: "gmail_scope_missing", reauthorize: true }, { status: 403 });
    }

    const messages = await loadMail();
    const priorities = await classify(messages);
    const byId = new Map(priorities.map((item) => [item.id, item]));
    const enriched = messages.map((message) => ({
      ...message,
      from: compactSender(message.from),
      priority: byId.get(message.id)?.priority ?? "baja",
      reason: byId.get(message.id)?.reason ?? "Sin señal clara de prioridad.",
      summary: byId.get(message.id)?.summary ?? message.snippet,
    })).sort((a, b) => {
      const rank = { alta: 3, media: 2, baja: 1 } as const;
      const priorityDiff = rank[b.priority] - rank[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.internalDate ?? 0).getTime() - new Date(a.internalDate ?? 0).getTime();
    });

    const counts = enriched.reduce(
      (acc, item) => { acc[item.priority] += 1; return acc; },
      { alta: 0, media: 0, baja: 0 } as Record<"alta" | "media" | "baja", number>,
    );

    try {
      await recordAction("gmail", "gmail_priority_briefing", `Analizó ${enriched.length} correos recientes: ${counts.alta} alta prioridad.`, {
        count: enriched.length,
        highPriority: counts.alta,
        mediumPriority: counts.media,
        lowPriority: counts.baja,
      });
    } catch (error) {
      console.error("ZYRON_GMAIL_PRIORITY_LOG_ERROR", error);
    }

    return NextResponse.json({
      connected: true,
      email: connection.email,
      query: QUERY,
      counts,
      messages: enriched,
      privacy: "Los correos se analizan para esta consulta y no se guardan aquí como memoria a largo plazo.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_GMAIL_PRIORITY_ERROR", error);
    const code = error instanceof Error ? error.message.split(":")[0] : "gmail_priority_unavailable";
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
