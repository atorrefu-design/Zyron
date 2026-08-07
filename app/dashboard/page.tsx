"use client";

import { useEffect, useState } from "react";
import "./dashboard.css";

type CheckResult = { configured: boolean; reachable: boolean | null; latencyMs: number | null };
type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; htmlLink: string | null };
type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email?: string | null;
  scope?: string | null;
  updatedAt?: string | null;
  error?: string;
};
type DashboardData = {
  summary: { pendingTasks: number; completedTasks: number; availableTools: number; plannedTools: number; activeGoals: number };
  health: { ok: boolean; version: string; time: string; checks: Record<string, CheckResult> };
  goals: Array<{ id: number; name: string; icon: string; progress: number; total_tasks: number; completed_tasks: number }>;
  nextTasks: Array<{ id: number; title: string; due_at: string | null }>;
  recentActions: Array<{ id: number; tool: string; action: string; summary: string; created_at: string }>;
  calendar: { connected: boolean; events: CalendarEvent[]; error: string | null };
  tools: Array<{ name: string; description: string; status: "available" | "needs_configuration" | "planned" }>;
};

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function checkLabel(check: CheckResult) {
  if (!check.configured) return "Sin configurar";
  if (check.reachable === false) return "No responde";
  if (check.reachable === true) return check.latencyMs === null ? "Operativo" : `Operativo · ${check.latencyMs} ms`;
  return "Configurado";
}

function eventTime(event: CalendarEvent) {
  if (event.allDay) return "Todo el día";
  return new Date(event.start).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function hasScope(scope: string | null | undefined, required: string) {
  return Boolean(scope?.split(/\s+/).includes(required));
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const [dashboardResponse, googleResponse] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/google/status", { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok) throw new Error();
      setData((await dashboardResponse.json()) as DashboardData);
      setGoogle(googleResponse.ok ? ((await googleResponse.json()) as GoogleStatus) : null);
    } catch {
      setError("No he podido cargar el panel de control.");
    }
  }
  useEffect(() => { void load(); }, []);

  const calendarAuthorized = hasScope(google?.scope, CALENDAR_SCOPE);
  const gmailAuthorized = hasScope(google?.scope, GMAIL_SCOPE);
  const googleActionLabel = !google?.connected ? "Conectar Google" : gmailAuthorized ? "Reautorizar Google" : "Autorizar Gmail";

  return (
    <main className="shell">
      <header className="header"><div><div className="brand">ZYRON</div><div className="status">● Panel del propietario</div></div><div className="headerActions"><a className="ghostButton navLink" href="/">Hablar</a><a className="ghostButton navLink" href="/goals">Objetivos</a><a className="ghostButton navLink" href="/tasks">Tareas</a><a className="ghostButton navLink" href="/activity">Actividad</a></div></header>
      <section className="panel dashboardPanel">
        <div><div className="eyebrow">Centro de operaciones</div><h1>Estado general</h1><p className="subtitle">Una vista compacta de lo que ZYRON tiene pendiente, ha ejecutado y puede utilizar.</p></div>
        {error && <div className="taskError">{error}</div>}
        {!data && !error && <div className="taskEmpty">Cargando sistemas…</div>}
        {data && <>
          <div className={`healthBanner ${data.health.ok ? "healthy" : "degraded"}`}><div><strong>{data.health.ok ? "Todos los sistemas operativos" : "Sistema parcialmente degradado"}</strong><span>Núcleo {data.health.version} · {new Date(data.health.time).toLocaleString("es-ES")}</span></div><button className="ghostButton" type="button" onClick={() => void load()}>Comprobar</button></div>
          <div className="serviceGrid">{Object.entries(data.health.checks).map(([name, check]) => <div className="serviceCard" key={name}><i className={!check.configured || check.reachable === false ? "bad" : "good"} /><div><strong>{name}</strong><span>{checkLabel(check)}</span></div></div>)}</div>

          <section className="dashboardBlock">
            <div className="blockHeader"><h2>Google</h2><a href="/api/google/connect">{googleActionLabel}</a></div>
            <div className="compactRow">
              <span>G</span>
              <div>
                <strong>{google?.connected ? (google.email || "Cuenta Google conectada") : "Google no conectado"}</strong>
                <small>
                  {!google?.configured
                    ? "OAuth de Google no está configurado."
                    : !google?.connected
                      ? "Conecta tu cuenta para usar Calendar y Gmail."
                      : `Calendar: ${calendarAuthorized ? "autorizado" : "falta permiso"} · Gmail: ${gmailAuthorized ? "lectura autorizada" : "falta autorizar"}`}
                </small>
              </div>
            </div>
            {google?.connected && !gmailAuthorized && <div className="mutedBox">Gmail está preparado, pero falta una autorización de Google. Pulsa “Autorizar Gmail” y acepta el permiso de lectura.</div>}
          </section>

          <div className="metricGrid"><div className="metricCard"><strong>{data.summary.pendingTasks}</strong><span>Tareas pendientes</span></div><div className="metricCard"><strong>{data.summary.completedTasks}</strong><span>Tareas completadas</span></div><div className="metricCard"><strong>{data.summary.activeGoals}</strong><span>Objetivos activos</span></div><div className="metricCard"><strong>{data.summary.availableTools}</strong><span>Capacidades activas</span></div></div>

          <section className="dashboardBlock"><div className="blockHeader"><h2>Próximos eventos</h2><a href="/api/calendar/events">Abrir datos</a></div>{data.calendar.error ? <div className="mutedBox">{data.calendar.error}</div> : data.calendar.events.length ? data.calendar.events.map((event) => <div className="compactRow" key={event.id}><span>◷</span><div><strong>{event.title}</strong><small>{eventTime(event)}{event.location ? ` · ${event.location}` : ""}</small></div></div>) : <div className="mutedBox">No hay eventos próximos en los siguientes siete días.</div>}</section>

          <section className="dashboardBlock"><div className="blockHeader"><h2>Progreso de objetivos</h2><a href="/goals">Ver todos</a></div><div className="toolGrid">{data.goals.map((goal) => <a className="toolCard goalDashboardCard" href={`/goals/${goal.id}`} key={goal.id}><div><strong>{goal.icon} {goal.name}</strong><span>{goal.progress}%</span></div><div className="goalMiniTrack"><i style={{ width: `${goal.progress}%` }} /></div><p>{goal.completed_tasks} de {goal.total_tasks} tareas completadas</p></a>)}</div></section>
          <div className="dashboardGrid"><section className="dashboardBlock"><div className="blockHeader"><h2>Próximas tareas</h2><a href="/tasks">Ver todas</a></div>{data.nextTasks.length ? data.nextTasks.map((task) => <div className="compactRow" key={task.id}><span>□</span><div><strong>{task.title}</strong><small>{task.due_at ? new Date(task.due_at).toLocaleString("es-ES") : "Sin fecha"}</small></div></div>) : <div className="mutedBox">No hay tareas pendientes.</div>}</section><section className="dashboardBlock"><div className="blockHeader"><h2>Actividad reciente</h2><a href="/activity">Abrir bitácora</a></div>{data.recentActions.length ? data.recentActions.map((item) => <div className="compactRow" key={item.id}><span>•</span><div><strong>{item.summary}</strong><small>{item.tool} · {new Date(item.created_at).toLocaleString("es-ES")}</small></div></div>) : <div className="mutedBox">Todavía no hay acciones registradas.</div>}</section></div>
          <section className="dashboardBlock toolsBlock"><div className="blockHeader"><h2>Capacidades</h2><button className="ghostButton" type="button" onClick={() => void load()}>Actualizar</button></div><div className="toolGrid">{data.tools.map((tool) => <div className="toolCard" key={tool.name}><div><strong>{tool.name}</strong><span className={`toolStatus ${tool.status}`}>{tool.status.replace("_", " ")}</span></div><p>{tool.description}</p></div>)}</div></section>
        </>}
      </section>
    </main>
  );
}
