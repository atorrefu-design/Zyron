import { NextResponse } from "next/server";
import {
  connectionHasScope,
  getGoogleAccessToken,
  getGoogleConnection,
  GMAIL_READONLY_SCOPE,
} from "../../../../lib/google/oauth";

export const runtime = "nodejs";

const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
  };
};

function classifyGoogleError(status: number, raw: string) {
  let body: GoogleErrorBody | null = null;
  try {
    body = JSON.parse(raw) as GoogleErrorBody;
  } catch {
    body = null;
  }

  const message = body?.error?.message || raw || `HTTP ${status}`;
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.details?.[0]?.reason || null;
  const normalized = `${reason || ""} ${message}`.toLowerCase();

  if (
    status === 403 &&
    (normalized.includes("accessnotconfigured") ||
      normalized.includes("service_disabled") ||
      normalized.includes("service disabled") ||
      normalized.includes("gmail api has not been used") ||
      normalized.includes("gmail.googleapis.com"))
  ) {
    return {
      code: "gmail_api_disabled",
      message: "El permiso OAuth está concedido, pero la API de Gmail no está habilitada en el proyecto de Google Cloud.",
      action: "enable_gmail_api",
    };
  }

  if (status === 401) {
    return {
      code: "google_token_rejected",
      message: "Google ha rechazado el token de acceso. Hay que volver a autorizar la cuenta.",
      action: "reauthorize_google",
    };
  }

  if (status === 403) {
    return {
      code: "gmail_forbidden",
      message: "Google ha rechazado el acceso a Gmail aunque el permiso figura concedido.",
      action: "check_google_cloud",
    };
  }

  return {
    code: `gmail_api_${status}`,
    message: "Gmail ha devuelto un error al comprobar la conexión.",
    action: "retry",
  };
}

export async function GET() {
  try {
    const connection = await getGoogleConnection();
    if (!connection) {
      return NextResponse.json({
        connected: false,
        scopeAuthorized: false,
        apiReachable: false,
        error: "google_not_connected",
        action: "connect_google",
      });
    }

    const scopeAuthorized = connectionHasScope(connection.scope, GMAIL_READONLY_SCOPE);
    if (!scopeAuthorized) {
      return NextResponse.json({
        connected: true,
        email: connection.email,
        scopeAuthorized: false,
        apiReachable: false,
        error: "gmail_scope_missing",
        action: "reauthorize_google",
      });
    }

    const accessToken = await getGoogleAccessToken();
    const response = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      const classified = classifyGoogleError(response.status, raw);
      return NextResponse.json({
        connected: true,
        email: connection.email,
        scopeAuthorized: true,
        apiReachable: false,
        status: response.status,
        error: classified.code,
        message: classified.message,
        action: classified.action,
      });
    }

    const profile = (await response.json()) as {
      emailAddress?: string;
      messagesTotal?: number;
      threadsTotal?: number;
    };

    return NextResponse.json({
      connected: true,
      email: profile.emailAddress || connection.email,
      scopeAuthorized: true,
      apiReachable: true,
      messagesTotal: profile.messagesTotal ?? null,
      threadsTotal: profile.threadsTotal ?? null,
      error: null,
      action: null,
    });
  } catch (error) {
    console.error("ZYRON_GMAIL_STATUS_ERROR", error);
    const code = error instanceof Error ? error.message : "gmail_status_unavailable";
    return NextResponse.json(
      {
        connected: null,
        scopeAuthorized: null,
        apiReachable: false,
        error: code,
        action: "retry",
      },
      { status: 502 },
    );
  }
}
