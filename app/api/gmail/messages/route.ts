import { NextRequest, NextResponse } from "next/server";
import {
  connectionHasScope,
  getGoogleAccessToken,
  getGoogleConnection,
  GMAIL_READONLY_SCOPE,
} from "../../../../lib/google/oauth";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_QUERY = "in:inbox newer_than:7d";
const MAX_RESULTS = 20;

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  resultSizeEstimate?: number;
};

type GmailHeader = { name: string; value: string };
type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function safeLimit(raw: string | null) {
  const parsed = Number(raw ?? "10");
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(parsed)));
}

async function gmailFetch<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`gmail_api_${response.status}${detail ? `:${detail.slice(0, 200)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export async function GET(request: NextRequest) {
  try {
    const connection = await getGoogleConnection();
    if (!connection) {
      return NextResponse.json(
        { error: "google_not_connected", connected: false, reauthorize: true, connectUrl: "/api/google/connect" },
        { status: 401 },
      );
    }

    if (!connectionHasScope(connection.scope, GMAIL_READONLY_SCOPE)) {
      return NextResponse.json(
        {
          error: "gmail_scope_missing",
          connected: true,
          email: connection.email,
          reauthorize: true,
          connectUrl: "/api/google/connect",
        },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() || DEFAULT_QUERY;
    const maxResults = safeLimit(url.searchParams.get("maxResults"));
    const accessToken = await getGoogleAccessToken();
    const params = new URLSearchParams({ q, maxResults: String(maxResults) });
    const listed = await gmailFetch<GmailListResponse>(`/messages?${params.toString()}`, accessToken);
    const refs = listed.messages ?? [];

    const messages = await Promise.all(
      refs.map(async (ref) => {
        const params = new URLSearchParams({ format: "metadata" });
        ["Subject", "From", "To", "Date"].forEach((name) => params.append("metadataHeaders", name));
        const message = await gmailFetch<GmailMessageResponse>(`/messages/${encodeURIComponent(ref.id)}?${params.toString()}`, accessToken);
        const headers = message.payload?.headers;
        return {
          id: message.id,
          threadId: message.threadId,
          subject: header(headers, "Subject") || "(Sin asunto)",
          from: header(headers, "From"),
          to: header(headers, "To"),
          date: header(headers, "Date"),
          snippet: message.snippet ?? "",
          unread: Boolean(message.labelIds?.includes("UNREAD")),
          starred: Boolean(message.labelIds?.includes("STARRED")),
          labels: message.labelIds ?? [],
          internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
        };
      }),
    );

    return NextResponse.json(
      {
        connected: true,
        email: connection.email,
        query: q,
        count: messages.length,
        resultSizeEstimate: listed.resultSizeEstimate ?? messages.length,
        messages,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_GMAIL_MESSAGES_ERROR", error);
    const code = error instanceof Error ? error.message.split(":")[0] : "gmail_unavailable";
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
