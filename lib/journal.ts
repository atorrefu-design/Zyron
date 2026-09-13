import { neon } from "@neondatabase/serverless";
import { learningKind, renderJournalContext, validJournalEntry, type JournalEntry } from "./journal-policy";

function sql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("journal_database_unavailable");
  return neon(url);
}
let ready: Promise<void> | undefined;
export function ensureJournal() {
  if (!ready) ready = (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS zyron_journal (
      id TEXT PRIMARY KEY, channel TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
      kind TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql()`CREATE INDEX IF NOT EXISTS zyron_journal_time ON zyron_journal (occurred_at DESC)`;
    await sql()`CREATE INDEX IF NOT EXISTS zyron_journal_search ON zyron_journal USING GIN (to_tsvector('spanish', content))`;
  })().catch(e => { ready = undefined; throw e; });
  return ready;
}

export async function appendJournal(entries: JournalEntry[]) {
  if (!entries.length || entries.length > 50 || !entries.every(validJournalEntry)) throw new Error("invalid_journal_entries");
  await ensureJournal();
  const data = entries.map(e => ({ ...e, kind: learningKind(e.role, e.content) }));
  const rows = await sql()`INSERT INTO zyron_journal (id,channel,role,content,occurred_at,kind)
    SELECT id,channel,role,content,"occurredAt"::timestamptz,kind FROM jsonb_to_recordset(${JSON.stringify(data)}::jsonb)
    AS x(id text,channel text,role text,content text,"occurredAt" text,kind text)
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  return rows.length;
}

export async function listJournal(query = "", before?: string, beforeId = "") {
  await ensureJournal();
  return await sql()`SELECT id,channel,role,content,occurred_at AS "occurredAt",kind FROM zyron_journal
    WHERE (${before || null}::timestamptz IS NULL OR (occurred_at,id) < (${before || null}::timestamptz,${beforeId}))
      AND (${query} = '' OR to_tsvector('spanish',content) @@ plainto_tsquery('spanish',${query}))
    ORDER BY occurred_at DESC,id DESC LIMIT 100` as JournalEntry[];
}

export async function journalContext(query: string, budget = 6500) {
  await ensureJournal();
  await importRetainedTelegramHistory();
  const [recent, relevant, preferences] = await Promise.all([
    sql()`SELECT id,channel,role,content,occurred_at AS "occurredAt",kind FROM zyron_journal ORDER BY occurred_at DESC,id DESC LIMIT 10`,
    sql()`SELECT id,channel,role,content,occurred_at AS "occurredAt",kind FROM zyron_journal
      WHERE to_tsvector('spanish',content) @@ websearch_to_tsquery('spanish',${query.slice(0,500)})
      ORDER BY occurred_at DESC,id DESC LIMIT 12`,
    sql()`SELECT id,channel,role,content,occurred_at AS "occurredAt",kind FROM zyron_journal
      WHERE role='user' AND kind IN ('preference','correction') ORDER BY occurred_at DESC,id DESC LIMIT 6`,
  ]);
  const unique = new Map<string, JournalEntry>();
  // Reserve room for current continuity, then matching history and learned preferences.
  for (const row of [...recent.slice(0,4), ...relevant, ...preferences, ...recent.slice(4)]) {
    const e = row as JournalEntry; unique.set(e.id,e);
  }
  return renderJournalContext([...unique.values()],budget);
}

export async function deleteJournal(id: string) {
  await ensureJournal();
  return (await sql()`DELETE FROM zyron_journal WHERE id=${id} RETURNING id`).length > 0;
}

export async function updateJournal(id: string, expectedContent: string, content: string) {
  await ensureJournal();
  return (await sql()`UPDATE zyron_journal SET content=${content},kind=CASE WHEN role='user' THEN ${learningKind('user',content)} ELSE 'assistant_statement' END
    WHERE id=${id} AND content=${expectedContent} RETURNING id`).length > 0;
}

export async function importRetainedTelegramHistory() {
  await ensureJournal();
  const exists = await sql()`SELECT to_regclass('zyron_channel_messages') AS messages, to_regclass('zyron_channel_bindings') AS bindings`;
  if (!exists[0]?.messages || !exists[0]?.bindings) return 0;
  // Only messages of the currently bound owner, never an unpaired chat.
  await sql()`CREATE TABLE IF NOT EXISTS zyron_journal_migrations (id TEXT PRIMARY KEY)`;
  const rows = await sql()`WITH migration AS (
    INSERT INTO zyron_journal_migrations (id) SELECT 'retained-telegram-v1'
    WHERE EXISTS (SELECT 1 FROM zyron_channel_bindings WHERE channel='telegram' AND enabled=true)
    ON CONFLICT (id) DO NOTHING RETURNING id
  )
    INSERT INTO zyron_journal (id,channel,role,content,occurred_at,kind)
    SELECT 'telegram:' || m.id::text,'telegram',m.role,m.content,m.created_at,
      CASE WHEN m.role='assistant' THEN 'assistant_statement' ELSE 'episode' END
    FROM zyron_channel_messages m JOIN zyron_channel_bindings b ON b.channel=m.channel AND b.external_chat_id=m.chat_id
    WHERE m.channel='telegram' AND b.enabled=true AND EXISTS (SELECT 1 FROM migration)
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  return rows.length;
}
