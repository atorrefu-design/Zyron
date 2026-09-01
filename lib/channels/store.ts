import { neon } from "@neondatabase/serverless";
import { createPairingCode, hashPairingCode, normalizePairingCode } from "./security";

export type ChannelBinding = {
  channel: string;
  external_user_id: string;
  external_chat_id: string;
  display_name: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ChannelMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChannelUpdateClaim =
  | { mode: "process"; reply: null }
  | { mode: "resend"; reply: string }
  | { mode: "duplicate"; reply: string | null }
  | { mode: "busy"; reply: null };

function databaseUrl() {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value) throw new Error("DATABASE_URL o POSTGRES_URL no está configurada");
  return value;
}

function sql() {
  return neon(databaseUrl());
}

export async function ensureChannelTables() {
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_channel_bindings (
      channel TEXT PRIMARY KEY,
      external_user_id TEXT NOT NULL,
      external_chat_id TEXT NOT NULL,
      display_name TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_channel_pairings (
      code_hash TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_channel_updates (
      channel TEXT NOT NULL,
      update_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      attempts INTEGER NOT NULL DEFAULT 1,
      reply_text TEXT,
      error TEXT,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (channel, update_id)
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_channel_messages (
      id BIGSERIAL PRIMARY KEY,
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      external_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE UNIQUE INDEX IF NOT EXISTS zyron_channel_message_external_id
    ON zyron_channel_messages (channel, external_message_id)
    WHERE external_message_id IS NOT NULL
  `;
}

export async function createChannelPairing(channel: string) {
  await ensureChannelTables();
  const code = createPairingCode();
  const codeHash = hashPairingCode(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1_000).toISOString();
  await sql()`
    UPDATE zyron_channel_pairings
    SET used_at = NOW()
    WHERE channel = ${channel} AND used_at IS NULL
  `;
  await sql()`
    DELETE FROM zyron_channel_pairings
    WHERE expires_at < NOW() - INTERVAL '7 days'
  `;
  await sql()`
    INSERT INTO zyron_channel_pairings (code_hash, channel, expires_at)
    VALUES (${codeHash}, ${channel}, ${expiresAt})
  `;
  return { code, expiresAt };
}

export async function redeemChannelPairing(input: {
  channel: string;
  code: string;
  externalUserId: string;
  externalChatId: string;
  displayName?: string | null;
}) {
  await ensureChannelTables();
  if (normalizePairingCode(input.code).length !== 8) return null;
  const rows = await sql()`
    WITH redeemed AS (
      UPDATE zyron_channel_pairings
      SET used_at = NOW()
      WHERE code_hash = ${hashPairingCode(input.code)}
        AND channel = ${input.channel}
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING channel
    )
    INSERT INTO zyron_channel_bindings (
      channel, external_user_id, external_chat_id, display_name, enabled
    )
    SELECT
      channel,
      ${input.externalUserId},
      ${input.externalChatId},
      ${input.displayName || null},
      TRUE
    FROM redeemed
    ON CONFLICT (channel) DO UPDATE SET
      external_user_id = EXCLUDED.external_user_id,
      external_chat_id = EXCLUDED.external_chat_id,
      display_name = EXCLUDED.display_name,
      enabled = TRUE,
      updated_at = NOW()
    RETURNING channel, external_user_id, external_chat_id, display_name, enabled, created_at, updated_at
  `;
  return (rows[0] as ChannelBinding | undefined) || null;
}

export async function getChannelBinding(channel: string) {
  await ensureChannelTables();
  const rows = await sql()`
    SELECT channel, external_user_id, external_chat_id, display_name, enabled, created_at, updated_at
    FROM zyron_channel_bindings
    WHERE channel = ${channel}
    LIMIT 1
  `;
  return (rows[0] as ChannelBinding | undefined) || null;
}

export async function disableChannelBinding(channel: string) {
  await ensureChannelTables();
  const rows = await sql()`
    UPDATE zyron_channel_bindings
    SET enabled = FALSE, updated_at = NOW()
    WHERE channel = ${channel}
    RETURNING channel
  `;
  return rows.length > 0;
}

export async function claimChannelUpdate(input: {
  channel: string;
  updateId: string;
  chatId: string;
}): Promise<ChannelUpdateClaim> {
  await ensureChannelTables();
  const rows = await sql()`
    WITH claimed AS (
      INSERT INTO zyron_channel_updates (channel, update_id, chat_id)
      VALUES (${input.channel}, ${input.updateId}, ${input.chatId})
      ON CONFLICT (channel, update_id) DO UPDATE SET
        attempts = zyron_channel_updates.attempts + 1,
        status = CASE
          WHEN zyron_channel_updates.status = 'reply_pending' THEN 'reply_pending'
          ELSE 'processing'
        END,
        claimed_at = NOW(),
        updated_at = NOW(),
        error = NULL
      WHERE zyron_channel_updates.status IN ('failed', 'reply_pending')
         OR (
           zyron_channel_updates.status = 'processing'
           AND zyron_channel_updates.claimed_at < NOW() - INTERVAL '2 minutes'
         )
      RETURNING status, reply_text, TRUE AS acquired
    )
    SELECT status, reply_text, acquired FROM claimed
    UNION ALL
    SELECT status, reply_text, FALSE AS acquired
    FROM zyron_channel_updates
    WHERE channel = ${input.channel}
      AND update_id = ${input.updateId}
      AND NOT EXISTS (SELECT 1 FROM claimed)
    LIMIT 1
  `;
  const row = rows[0] as { status?: string; reply_text?: string | null; acquired?: boolean } | undefined;
  if (!row) return { mode: "busy", reply: null };
  if (row.acquired && row.status === "reply_pending" && row.reply_text) return { mode: "resend", reply: row.reply_text };
  if (row.acquired) return { mode: "process", reply: null };
  if (row.status === "completed") return { mode: "duplicate", reply: row.reply_text || null };
  return { mode: "busy", reply: null };
}

export async function saveChannelUpdateReply(channel: string, updateId: string, reply: string) {
  await ensureChannelTables();
  await sql()`
    UPDATE zyron_channel_updates
    SET status = 'reply_pending',
        reply_text = ${reply.slice(0, 20_000)},
        updated_at = NOW()
    WHERE channel = ${channel} AND update_id = ${updateId}
  `;
}

export async function completeChannelUpdate(channel: string, updateId: string) {
  await ensureChannelTables();
  await sql()`
    UPDATE zyron_channel_updates
    SET status = 'completed',
        completed_at = NOW(),
        updated_at = NOW(),
        error = NULL
    WHERE channel = ${channel} AND update_id = ${updateId}
  `;
}

export async function failChannelUpdate(channel: string, updateId: string, error: string) {
  await ensureChannelTables();
  await sql()`
    UPDATE zyron_channel_updates
    SET status = CASE WHEN reply_text IS NULL THEN 'failed' ELSE 'reply_pending' END,
        error = ${error.slice(0, 500)},
        updated_at = NOW()
    WHERE channel = ${channel} AND update_id = ${updateId}
  `;
}

export async function appendChannelMessage(input: {
  channel: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  externalMessageId?: string;
}) {
  await ensureChannelTables();
  await sql()`
    DELETE FROM zyron_channel_messages
    WHERE channel = ${input.channel}
      AND created_at < NOW() - INTERVAL '30 days'
  `;
  await sql()`
    INSERT INTO zyron_channel_messages (
      channel, chat_id, role, content, external_message_id
    )
    VALUES (
      ${input.channel},
      ${input.chatId},
      ${input.role},
      ${input.content.slice(0, 20_000)},
      ${input.externalMessageId || null}
    )
    ON CONFLICT (channel, external_message_id)
      WHERE external_message_id IS NOT NULL
    DO NOTHING
  `;
}

export async function listRecentChannelMessages(channel: string, chatId: string, limit = 16): Promise<ChannelMessage[]> {
  await ensureChannelTables();
  const safeLimit = Math.max(1, Math.min(limit, 24));
  const rows = await sql()`
    SELECT role, content
    FROM (
      SELECT id, role, content, created_at
      FROM zyron_channel_messages
      WHERE channel = ${channel} AND chat_id = ${chatId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
    ) recent
    ORDER BY created_at ASC, id ASC
  `;
  return rows as ChannelMessage[];
}

export async function clearChannelMessages(channel: string, chatId: string) {
  await ensureChannelTables();
  const rows = await sql()`
    DELETE FROM zyron_channel_messages
    WHERE channel = ${channel} AND chat_id = ${chatId}
    RETURNING id
  `;
  return rows.length;
}
