"use client";

import { useEffect, useState } from "react";
import "./dashboard.css";

type CheckResult = { configured: boolean; reachable: boolean | null; latencyMs: number | null };
type DashboardData = {
  summary: { pendingTasks: number; completedTasks: number; availableTools: number; plannedTools: number };
  health: { ok: boolean; version: string; time: string; checks: Record<string, CheckResult> };
  nextTasks: Array<{ id: number; title: string; due_at: string | null }>;
  recentActions: Array<{ id: number; tool: string; action: string; summary: string; created_at: string }>;
  tools: Array<{ name: string; description: string; status: "available" | "needs_configuration" | "planned" }>;
};

function checkLabel(check: CheckResult) {
  if (!check.configured) return "Sin configurar";
  if (check.reachable === false) return "No responde";
  if (check.reachable === true) return check.latencyMs === null ? "Operativo" : `Operativo · ${check.latencyMs} ms`;
  return "Configurado";
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData((await response.json()) as DashboardData);
    } catch { setError("No he podido cargar el panel de control."); }
  }
  useEffect(() => { void load(); }, []);

  return (
    <main className="shell">
      <header className="header"><div><div className="brand">ZYRON</div><div className="status">● Panel del propietario</div></div><div className="headerActions"><a className="ghostButton navLink" href="/">Hablar</a><a className="ghostButton navLink" href="/tasks">Tareas</a><a className="ghostButton navLink" href="/activity">Actividad</a></div></header>
      <section className="panel dashboardPanel">
        <div><div className="eyebrow">Centro de operaciones</div><h1>Estado general</h1><p className="subtitle">Una vista compacta de lo que ZYRON tiene pendiente, ha ejecutado y puede utilizar.</p></div>
        {error && <div className="taskError">{error}</div>}
        {!data && !error && <div className="taskEmpty">Cargando sistemas…</div>}
        {data && <>
          <div className={`healthBanner ${data.health.ok ? "healthy" : "degraded"}`}><div><strong>{data.health.ok ? "Todos los sistemas operativos" : "Sistema parcialmente degradado"}</strong><span>Núcleo {data.health.version} · {new Date(data.health.time).toLocaleString("es-ES")}</span></div><button className="ghostButton" type="button" onClick={() => void load()}>Comprobar</button></div>
          <div className="serviceGrid">{Object.entries(data.health.checks).map(([name, check]) => <div className="serviceCard" key={name}><i className={!check.configured || check.reachable === false ? "bad" : "good"} /><div><strong>{name}</strong><span>{checkLabel(check)}</span></div></div>)}</div>
          <div className="metricGrid"><div className="metricCard"><strong>{data.summary.pendingTasks}</strong><span>Tareas pendientes</span></div><div className="metricCard"><strong>{data.summary.completedTasks}</strong><span>Tareas completadas</span></div><div className="metricCard"><strong>{data.summary.availableTools}</strong><span>Capacidades activas</span></div><div className="metricCard"><strong>{data.summary.plannedTools}</strong><span>Capacidades previstas</span></div></div>
          <div className="dashboardGrid"><section className="dashboardBlock"><div className="blockHeader"><h2>Próximas tareas</h2><a href="/tasks">Ver todas</a></div>{data.nextTasks.length ? data.nextTasks.map((task) => <div className="compactRow" key={task.id}><span>□</span><div><strong>{task.title}</strong><small>{task.due_at ? new Date(task.due_at).toLocaleString("es-ES") : "Sin fecha"}</small></div></div>) : <div className="mutedBox">No hay tareas pendientes.</div>}</section><section className="dashboardBlock"><div className="blockHeader"><h2>Actividad reciente</h2><a href="/activity">Abrir bitácora</a></div>{data.recentActions.length ? data.recentActions.map((item) => <div className="compactRow" key={item.id}><span>•</span><div><strong>{item.summary}</strong><small>{item.tool} · {new Date(item.created_at).toLocaleString("es-ES")}</small></div></div>) : <div className="mutedBox">Todavía no hay acciones registradas.</div>}</section></div>
          <section className="dashboardBlock toolsBlock"><div className="blockHeader"><h2>Capacidades</h2><button className="ghostButton" type="button" onClick={() => void load()}>Actualizar</button></div><div className="toolGrid">{data.tools.map((tool) => <div className="toolCard" key={tool.name}><div><strong>{tool.name}</strong><span className={`toolStatus ${tool.status}`}>{tool.status.replace("_", " ")}</span></div><p>{tool.description}</p></div>)}</div></section>
        </>}
      </section>
    </main>
  );
}
