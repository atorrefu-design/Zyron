import { neon } from "@neondatabase/serverless";

export type BluetoothContextName = "vehicle" | "headphones" | "work" | "home" | "other";
export type BluetoothContextAction = "briefing" | "daily_plan" | "diagnostics" | "record_only";

export type BluetoothContextEvent = {
  context: BluetoothContextName;
  action: BluetoothContextAction;
  deviceName: string | null;
};

export type CurrentDeviceContext = BluetoothContextEvent & {
  connectedAt: string;
  expiresAt: string;
};

const CONTEXTS = new Set<BluetoothContextName>(["vehicle", "headphones", "work", "home", "other"]);
const ACTIONS = new Set<BluetoothContextAction>(["briefing", "daily_plan", "diagnostics", "record_only"]);

export const bluetoothContextLabels: Record<BluetoothContextName, string> = {
  vehicle: "coche",
  headphones: "auriculares",
  work: "trabajo",
  home: "casa",
  other: "otro dispositivo",
};

export function normalizeBluetoothContextEvent(value: unknown): BluetoothContextEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as { context?: unknown; action?: unknown; deviceName?: unknown };
  if (typeof body.context !== "string" || !CONTEXTS.has(body.context as BluetoothContextName)) return null;
  const context = body.context as BluetoothContextName;
  const defaultAction: BluetoothContextAction = context === "vehicle" ? "briefing" : "record_only";
  const action = typeof body.action === "string" && ACTIONS.has(body.action as BluetoothContextAction)
    ? body.action as BluetoothContextAction
    : defaultAction;
  const deviceName = typeof body.deviceName === "string"
    ? body.deviceName.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || null
    : null;
  return { context, action, deviceName };
}

function databaseUrl() {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value) throw new Error("database_not_configured");
  return value;
}

async function ensureTable() {
  const sql = neon(databaseUrl());
  await sql`
    CREATE TABLE IF NOT EXISTS zyron_device_context (
      id INTEGER PRIMARY KEY,
      context TEXT NOT NULL,
      action TEXT NOT NULL,
      device_name TEXT,
      connected_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
  return sql;
}

function ttlHours(context: BluetoothContextName) {
  if (context === "vehicle") return 4;
  if (context === "work" || context === "home") return 12;
  return 8;
}

export async function saveBluetoothContext(event: BluetoothContextEvent, now = new Date()): Promise<CurrentDeviceContext> {
  const sql = await ensureTable();
  const expiresAt = new Date(now.getTime() + ttlHours(event.context) * 60 * 60 * 1_000);
  await sql`
    INSERT INTO zyron_device_context (id, context, action, device_name, connected_at, expires_at)
    VALUES (1, ${event.context}, ${event.action}, ${event.deviceName}, ${now.toISOString()}, ${expiresAt.toISOString()})
    ON CONFLICT (id) DO UPDATE SET
      context = EXCLUDED.context,
      action = EXCLUDED.action,
      device_name = EXCLUDED.device_name,
      connected_at = EXCLUDED.connected_at,
      expires_at = EXCLUDED.expires_at
  `;
  return { ...event, connectedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
}

export async function getCurrentDeviceContext(now = new Date()): Promise<CurrentDeviceContext | null> {
  const sql = neon(databaseUrl());
  let rows;
  try {
    rows = await sql`
      SELECT context, action, device_name, connected_at, expires_at
      FROM zyron_device_context
      WHERE id = 1 AND expires_at > ${now.toISOString()}
      LIMIT 1
    `;
  } catch (error) {
    if (error instanceof Error && /zyron_device_context|does not exist/i.test(error.message)) return null;
    throw error;
  }
  const row = rows[0] as {
    context: BluetoothContextName;
    action: BluetoothContextAction;
    device_name: string | null;
    connected_at: string | Date;
    expires_at: string | Date;
  } | undefined;
  if (!row || !CONTEXTS.has(row.context) || !ACTIONS.has(row.action)) return null;
  return {
    context: row.context,
    action: row.action,
    deviceName: row.device_name,
    connectedAt: new Date(row.connected_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export function renderDeviceContext(context: CurrentDeviceContext | null) {
  if (!context) return "No hay un contexto Bluetooth vigente.";
  const device = context.deviceName ? ` mediante ${context.deviceName}` : "";
  return `Contexto Bluetooth vigente: ${bluetoothContextLabels[context.context]}${device}. Detectado: ${context.connectedAt}. Caduca: ${context.expiresAt}. No presupongas que sigue conectado después de esa hora.`;
}
