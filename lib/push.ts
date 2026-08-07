import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";

export type BrowserPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type PushConfigRow = {
  public_key: string;
  private_key_enc: string;
};

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("push_database_not_configured");
  return url;
}

function sql() {
  return neon(getDatabaseUrl());
}

function secretKey() {
  const secret = process.env.ZYRON_AUTH_SECRET;
  if (!secret) throw new Error("push_auth_secret_not_configured");
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("push_secret_invalid");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function ensurePushTables() {
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_push_config (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      public_key TEXT NOT NULL,
      private_key_enc TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_push_sent_alerts (
      alert_id TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_push_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      last_dispatch_at TIMESTAMPTZ
    )
  `;
}

export async function getOrCreateVapidKeys() {
  await ensurePushTables();
  let rows = await sql()`SELECT public_key, private_key_enc FROM zyron_push_config WHERE id = 1`;
  if (!rows.length) {
    const generated = webpush.generateVAPIDKeys();
    const encryptedPrivateKey = encryptSecret(generated.privateKey);
    await sql()`
      INSERT INTO zyron_push_config (id, public_key, private_key_enc)
      VALUES (1, ${generated.publicKey}, ${encryptedPrivateKey})
      ON CONFLICT (id) DO NOTHING
    `;
    rows = await sql()`SELECT public_key, private_key_enc FROM zyron_push_config WHERE id = 1`;
  }
  const row = rows[0] as PushConfigRow | undefined;
  if (!row) throw new Error("push_vapid_unavailable");
  return {
    publicKey: row.public_key,
    privateKey: decryptSecret(row.private_key_enc),
  };
}

export async function savePushSubscription(subscription: BrowserPushSubscription, userAgent?: string | null) {
  await ensurePushTables();
  const endpoint = subscription.endpoint?.trim();
  const p256dh = subscription.keys?.p256dh?.trim();
  const auth = subscription.keys?.auth?.trim();
  if (!endpoint?.startsWith("https://") || !p256dh || !auth) throw new Error("push_subscription_invalid");

  await sql()`
    INSERT INTO zyron_push_subscriptions (endpoint, p256dh, auth, user_agent, enabled, updated_at)
    VALUES (${endpoint}, ${p256dh}, ${auth}, ${userAgent || null}, TRUE, NOW())
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      enabled = TRUE,
      updated_at = NOW()
  `;
}

export async function countPushSubscriptions() {
  await ensurePushTables();
  const rows = await sql()`SELECT COUNT(*)::int AS count FROM zyron_push_subscriptions WHERE enabled = TRUE`;
  return Number(rows[0]?.count ?? 0);
}

async function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  await ensurePushTables();
  const rows = await sql()`
    SELECT endpoint, p256dh, auth
    FROM zyron_push_subscriptions
    WHERE enabled = TRUE
    ORDER BY updated_at DESC
    LIMIT 20
  `;
  return rows as PushSubscriptionRow[];
}

async function disableSubscription(endpoint: string) {
  await sql()`UPDATE zyron_push_subscriptions SET enabled = FALSE, updated_at = NOW() WHERE endpoint = ${endpoint}`;
}

export async function sendPushNotification(payload: PushPayload) {
  const subscriptions = await listPushSubscriptions();
  if (!subscriptions.length) return { sent: 0, failed: 0, disabled: 0 };

  const vapid = await getOrCreateVapidKeys();
  webpush.setVapidDetails("mailto:zyron-notifications@localhost.invalid", vapid.publicKey, vapid.privateKey);

  let sent = 0;
  let failed = 0;
  let disabled = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 300 },
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await disableSubscription(subscription.endpoint).catch(() => undefined);
        disabled += 1;
      }
    }
  }
  return { sent, failed, disabled };
}

export async function wasAlertSent(alertId: string) {
  await ensurePushTables();
  const rows = await sql()`SELECT 1 AS found FROM zyron_push_sent_alerts WHERE alert_id = ${alertId} LIMIT 1`;
  return rows.length > 0;
}

export async function markAlertsSent(alertIds: string[]) {
  await ensurePushTables();
  for (const alertId of alertIds) {
    await sql()`
      INSERT INTO zyron_push_sent_alerts (alert_id)
      VALUES (${alertId})
      ON CONFLICT (alert_id) DO NOTHING
    `;
  }
  await sql()`DELETE FROM zyron_push_sent_alerts WHERE sent_at < NOW() - INTERVAL '30 days'`;
}

export async function claimPushDispatchWindow() {
  await ensurePushTables();
  const rows = await sql()`
    INSERT INTO zyron_push_state (id, last_dispatch_at)
    VALUES (1, NOW())
    ON CONFLICT (id) DO UPDATE SET last_dispatch_at = NOW()
    WHERE zyron_push_state.last_dispatch_at IS NULL
       OR zyron_push_state.last_dispatch_at < NOW() - INTERVAL '20 minutes'
    RETURNING last_dispatch_at
  `;
  return rows.length > 0;
}
