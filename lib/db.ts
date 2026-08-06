import { neon } from "@neondatabase/serverless";

export type ZyronTask = {
  id: number;
  title: string;
  due_at: string | null;
  completed: boolean;
  goal_id: number | null;
  created_at: string;
};

export type ZyronGoal = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  description: string | null;
  active: boolean;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  created_at: string;
};

export type ZyronAction = {
  id: number;
  tool: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
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

export async function ensureGoalsTable() {
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_goals (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL DEFAULT '🎯',
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const defaults = [
    ["ZYRON", "zyron", "🤖"],
    ["Vivienda", "vivienda", "🏡"],
    ["Maninter", "maninter", "💼"],
    ["Baloncesto", "baloncesto", "🏀"],
  ] as const;

  for (const [name, slug, icon] of defaults) {
    await sql()`
      INSERT INTO zyron_goals (name, slug, icon)
      VALUES (${name}, ${slug}, ${icon})
      ON CONFLICT (slug) DO NOTHING
    `;
  }
}

export async function ensureTasksTable() {
  await ensureGoalsTable();
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_tasks (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      due_at TIMESTAMPTZ,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      goal_id BIGINT REFERENCES zyron_goals(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`ALTER TABLE zyron_tasks ADD COLUMN IF NOT EXISTS goal_id BIGINT REFERENCES zyron_goals(id) ON DELETE SET NULL`;
}

export async function ensureActionsTable() {
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_actions (
      id BIGSERIAL PRIMARY KEY,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function listGoals(): Promise<ZyronGoal[]> {
  await ensureTasksTable();
  const rows = await sql()`
    SELECT
      g.id,
      g.name,
      g.slug,
      g.icon,
      g.description,
      g.active,
      COUNT(t.id)::int AS total_tasks,
      COUNT(t.id) FILTER (WHERE t.completed)::int AS completed_tasks,
      CASE
        WHEN COUNT(t.id) = 0 THEN 0
        ELSE ROUND((COUNT(t.id) FILTER (WHERE t.completed)::numeric / COUNT(t.id)::numeric) * 100)::int
      END AS progress,
      g.created_at
    FROM zyron_goals g
    LEFT JOIN zyron_tasks t ON t.goal_id = g.id
    GROUP BY g.id
    ORDER BY g.active DESC, g.created_at ASC
  `;
  return rows as ZyronGoal[];
}

export async function createGoal(name: string, slug: string, icon = "🎯", description?: string | null): Promise<ZyronGoal> {
  await ensureGoalsTable();
  const rows = await sql()`
    INSERT INTO zyron_goals (name, slug, icon, description)
    VALUES (${name}, ${slug}, ${icon}, ${description || null})
    RETURNING id, name, slug, icon, description, active, 0::int AS total_tasks, 0::int AS completed_tasks, 0::int AS progress, created_at
  `;
  return rows[0] as ZyronGoal;
}

export async function listTasks(): Promise<ZyronTask[]> {
  await ensureTasksTable();
  const rows = await sql()`
    SELECT id, title, due_at, completed, goal_id, created_at
    FROM zyron_tasks
    ORDER BY completed ASC, due_at ASC NULLS LAST, created_at DESC
    LIMIT 100
  `;
  return rows as ZyronTask[];
}

export async function createTask(title: string, dueAt?: string | null, goalId?: number | null): Promise<ZyronTask> {
  await ensureTasksTable();
  const rows = await sql()`
    INSERT INTO zyron_tasks (title, due_at, goal_id)
    VALUES (${title}, ${dueAt || null}, ${goalId || null})
    RETURNING id, title, due_at, completed, goal_id, created_at
  `;
  return rows[0] as ZyronTask;
}

export async function assignTaskToGoal(taskId: number, goalId: number | null): Promise<ZyronTask | null> {
  await ensureTasksTable();
  const rows = await sql()`
    UPDATE zyron_tasks
    SET goal_id = ${goalId}
    WHERE id = ${taskId}
    RETURNING id, title, due_at, completed, goal_id, created_at
  `;
  return (rows[0] as ZyronTask | undefined) || null;
}

export async function setTaskCompleted(id: number, completed: boolean): Promise<ZyronTask | null> {
  await ensureTasksTable();
  const rows = await sql()`
    UPDATE zyron_tasks
    SET completed = ${completed}
    WHERE id = ${id}
    RETURNING id, title, due_at, completed, goal_id, created_at
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

export async function recordAction(
  tool: string,
  action: string,
  summary: string,
  metadata: Record<string, unknown> = {},
): Promise<ZyronAction> {
  await ensureActionsTable();
  const rows = await sql()`
    INSERT INTO zyron_actions (tool, action, summary, metadata)
    VALUES (${tool}, ${action}, ${summary}, ${JSON.stringify(metadata)}::jsonb)
    RETURNING id, tool, action, summary, metadata, created_at
  `;
  return rows[0] as ZyronAction;
}

export async function listActions(limit = 50): Promise<ZyronAction[]> {
  await ensureActionsTable();
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const rows = await sql()`
    SELECT id, tool, action, summary, metadata, created_at
    FROM zyron_actions
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows as ZyronAction[];
}
