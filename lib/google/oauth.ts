import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_SCOPES = [CALENDAR_SCOPE, GMAIL_READONLY_SCOPE] as const;

type StoredGoogleConnection = {
  provider: "google";
  encrypted_refresh_token: string;
  scope: string;
  email: string | null;
  updated_at: string;
};

function databaseUrl() {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value) throw new Error("database_not_configured");
  return value;
}

function googleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("google_oauth_not_configured");
  return { clientId, clientSecret };
}

function secretKey() {
  const source = process.env.ZYRON_AUTH_SECRET;
  if (!source) throw new Error("auth_secret_not_configured");
  return createHash("sha256").update(source).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((item) => item.toString("base64url")).join(".");
}

function decrypt(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("invalid_encrypted_token");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function sign(payload: string) {
  return createHmac("sha256", secretKey()).update(payload).digest("base64url");
}

export function createOAuthState() {
  const payload = Buffer.from(JSON.stringify({ issuedAt: Date.now(), nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyOAuthState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { issuedAt?: number };
    return typeof parsed.issuedAt === "number" && Date.now() - parsed.issuedAt < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

export function buildGoogleAuthorizationUrl(origin: string, state: string) {
  const { clientId } = googleCredentials();
  const redirectUri = `${origin}/api/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${GOOGLE_SCOPES.join(" ")}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function ensureConnectionsTable() {
  const sql = neon(databaseUrl());
  await sql`
    CREATE TABLE IF NOT EXISTS zyron_connections (
      provider TEXT PRIMARY KEY,
      encrypted_refresh_token TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      email TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function exchangeCode(origin: string, code: string) {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/google/callback`,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`google_token_exchange_${response.status}`);
  const token = (await response.json()) as { refresh_token?: string; access_token?: string; scope?: string; id_token?: string };
  if (!token.refresh_token) throw new Error("google_refresh_token_missing");

  let email: string | null = null;
  if (token.id_token) {
    try {
      const payload = token.id_token.split(".")[1];
      email = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string }).email ?? null;
    } catch { email = null; }
  }

  await ensureConnectionsTable();
  const sql = neon(databaseUrl());
  await sql`
    INSERT INTO zyron_connections (provider, encrypted_refresh_token, scope, email, updated_at)
    VALUES ('google', ${encrypt(token.refresh_token)}, ${token.scope || GOOGLE_SCOPES.join(" ")}, ${email}, NOW())
    ON CONFLICT (provider) DO UPDATE SET
      encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
      scope = EXCLUDED.scope,
      email = EXCLUDED.email,
      updated_at = NOW()
  `;
  return { email, scope: token.scope || GOOGLE_SCOPES.join(" ") };
}

export async function getGoogleConnection() {
  await ensureConnectionsTable();
  const sql = neon(databaseUrl());
  const rows = await sql`
    SELECT provider, encrypted_refresh_token, scope, email, updated_at
    FROM zyron_connections WHERE provider = 'google' LIMIT 1
  `;
  return (rows[0] as StoredGoogleConnection | undefined) ?? null;
}

export function connectionHasScope(scopeValue: string | null | undefined, requiredScope: string) {
  return Boolean(scopeValue?.split(/\s+/).includes(requiredScope));
}

export async function getGoogleAccessToken() {
  const connection = await getGoogleConnection();
  if (!connection) throw new Error("google_not_connected");
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decrypt(connection.encrypted_refresh_token),
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`google_token_refresh_${response.status}`);
  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("google_access_token_missing");
  return token.access_token;
}

export function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.ZYRON_AUTH_SECRET);
}
