import { neon } from "@neondatabase/serverless";

export type ZyronTask = {
  id: number;
  title: string;
  due_at: string | null;
  completed: boolean;
  created_at: string;
};

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL o POSTGRES_URL no está configurada");
  return url;
}

function sql() {
  return neon(getDatabaseUrl());
}

export async function ensureTasksTable() {
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_tasks (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      due_at TIMESTAMPTZ,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function listTasks(): Promise<ZyronTask[]> {
  await ensureTasksTable();
  const rows = await sql()`
    SELECT id, title, due_at, completed, created_at
    FROM zyron_tasks
    ORDER BY completed ASC, due_at ASC NULLS LAST, created_at DESC
    LIMIT 100
  `;
  return rows as ZyronTask[];
}

export async function createTask(title: string, dueAt?: string | null): Promise<ZyronTask> {
  await ensureTasksTable();
  const rows = await sql()`
    INSERT INTO zyron_tasks (title, due_at)
    VALUES (${title}, ${dueAt || null})
    RETURNING id, title, due_at, completed, created_at
  `;
  return rows[0] as ZyronTask;
}

export async function setTaskCompleted(id: number, completed: boolean): Promise<ZyronTask | null> {
  await ensureTasksTable();
  const rows = await sql()`
    UPDATE zyron_tasks
    SET completed = ${completed}
    WHERE id = ${id}
    RETURNING id, title, due_at, completed, created_at
  `;
  return (rows[0] as ZyronTask | undefined) || null;
}

export async function deleteTask(id: number): Promise<boolean> {
  await ensureTasksTable();
  const rows = await sql()`
    DELETE FROM zyron_tasks
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}
