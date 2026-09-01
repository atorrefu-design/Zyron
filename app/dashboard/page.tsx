"use client";

import { useEffect, useState } from "react";
import "./dashboard.css";

type CheckResult = { configured: boolean; reachable: boolean | null; latencyMs: number | null; detail?: string };
type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; htmlLink: string | null };
type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email?: string | null;
  scope?: string | null;
  updatedAt?: string | null;
  error?: string;
};
type ProactiveAlert = {
  id: string;
  severity: "alta" | "media" | "baja";
  source: "system" | "tasks" | "calendar" | "gmail";
  title: string;
  detail: string;
  suggestedAction: string;
  eventAt?: string | null;
};
type ProactiveData = {
  alerts: ProactiveAlert[];
  generatedAt: string;
  diagnostics: Record<string, "ok" | "unavailable">;
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
type PushState = "checking" | "ready" | "active" | "needs_install" | "denied" | "unsupported" | "error";
type PushStatusResponse = { configured?: boolean; publicKey?: string; subscriptions?: number; error?: string };

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function checkLabel(check: CheckResult) {
  if (!check.configured) return "Sin configurar";
  if (check.reachable === false) {
    const detail = check.detail || "";
    if (detail === "timeout") return "Tiempo de espera agotado";
    if (/http_401/.test(detail)) return "API key rechazada · 401";
    if (/http_403/.test(detail)) return "Acceso denegado · 403";
    if (/http_429/.test(detail)) return "Límite temporal · 429";
    if (/http_5\d\d/.test(detail)) return "Servicio externo con error";
    return "No responde";
  }
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

function alertIcon(alert: ProactiveAlert) {
  if (alert.severity === "alta") return "!";
  if (alert.source === "calendar") return "◷";
  if (alert.source === "gmail") return "✉";
  if (alert.source === "tasks") return "□";
  return "•";
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [proactive, setProactive] = useState<ProactiveData | null>(null);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState("");
  const [pushBusy, setPushBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const [dashboardResponse, googleResponse, proactiveResponse] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/google/status", { cache: "no-store" }),
        fetch("/api/alerts", { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok) throw new Error();
      setData((await dashboardResponse.json()) as DashboardData);
      setGoogle(googleResponse.ok ? ((await googleResponse.json()) as GoogleStatus) : null);
      setProactive(proactiveResponse.ok ? ((await proactiveResponse.json()) as ProactiveData) : null);
    } catch {
      setError("No he podido cargar el panel de control.");
    }
  }

  async function inspectPush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setPushState("unsupported");
        setPushMessage("Este navegador no admite notificaciones web push.");
        return;
      }
      const isiPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isiPhone && !isStandalone()) {
        setPushState("needs_install");
        setPushMessage("En iPhone, añade ZYRON a la pantalla de inicio desde Safari para recibir avisos con ZYRON cerrado.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        setPushState("active");
        setPushMessage("Este dispositivo ya puede recibir avisos de ZYRON.");
      } else if (Notification.permission === "denied") {
        setPushState("denied");
        setPushMessage("Las notificaciones están bloqueadas para ZYRON en este dispositivo.");
      } else {
        setPushState("ready");
        setPushMessage("Listo para activar avisos proactivos en este dispositivo.");
      }
    } catch {
      setPushState("error");
      setPushMessage("No he podido comprobar las notificaciones de este dispositivo.");
    }
  }

  async function enablePush() {
    if (pushBusy) return;
    if (pushState === "needs_install") {
      setPushMessage("Abre ZYRON en Safari, pulsa Compartir → Añadir a pantalla de inicio, abre el icono de ZYRON y vuelve a este Panel.");
      return;
    }
    setPushBusy(true);
    setPushMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("push_unsupported");
      const statusResponse = await fetch("/api/push", { cache: "no-store" });
      const status = (await statusResponse.json()) as PushStatusResponse;
      if (!statusResponse.ok || !status.publicKey) throw new Error(status.error || "push_not_configured");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "denied" : "ready");
        setPushMessage(permission === "denied" ? "Has bloqueado las notificaciones. Puedes reactivarlas desde los ajustes del iPhone." : "No se ha concedido permiso para notificaciones.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(status.publicKey) as BufferSource,
        });
      }

      const subscribeResponse = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", subscription: subscription.toJSON() }),
      });
      if (!subscribeResponse.ok) throw new Error("push_subscription_failed");

      const testResponse = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      if (!testResponse.ok) throw new Error("push_test_failed");

      setPushState("active");
      setPushMessage("Avisos activados. He enviado una notificación de prueba a este dispositivo.");
    } catch (pushError) {
      console.error("ZYRON_PUSH_ENABLE_ERROR", pushError);
      setPushState("error");
      setPushMessage("No he podido activar los avisos. Vuelve a intentarlo desde la app de ZYRON instalada en la pantalla de inicio.");
    } finally {
      setPushBusy(false);
    }
  }

  async function sendPushTest() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      if (!response.ok) throw new Error();
      setPushMessage("Notificación de prueba enviada.");
    } catch {
      setPushMessage("No he podido enviar la prueba. Revisa que los avisos sigan permitidos.");
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => { void load(); void inspectPush(); }, []);

  const calendarAuthorized = hasScope(google?.scope, CALENDAR_SCOPE);
  const gmailAuthorized = hasScope(google?.scope, GMAIL_SCOPE);
  const driveAuthorized = hasScope(google?.scope, DRIVE_SCOPE);
  const googleActionLabel = !google?.connected ? "Conectar Google" : gmailAuthorized && driveAuthorized ? "Reautorizar Google" : "Ampliar permisos Google";

  return (
    <main className="shell">
      <header className="header"><div><div className="brand">ZYRON</div><div className="status">● Panel del propietario</div></div><div className="headerActions"><a className="ghostButton navLink" href="/">Hablar</a><a className="ghostButton navLink" href="/goals">Objetivos</a><a className="ghostButton navLink" href="/tasks">Tareas</a><a className="ghostButton navLink" href="/activity">Actividad</a></div></header>
      <section className="panel dashboardPanel">
        <div><div className="eyebrow">Centro de operaciones</div><h1>Estado general</h1><p className="subtitle">Una vista compacta de lo que ZYRON tiene pendiente, ha ejecutado y puede utilizar.</p></div>
        {error && <div className="taskError">{error}</div>}
        {!data && !error && <div className="taskEmpty">Cargando sistemas…</div>}
        {data && <>
          <div className={`healthBanner ${data.health.ok ? "healthy" : "degraded"}`}><div><strong>{data.health.ok ? "Todos los sistemas operativos" : "Sistema parcialmente degradado"}</strong><span>Núcleo {data.health.version} · {new Date(data.health.time).toLocaleString("es-ES")}</span></div><button className="ghostButton" type="button" onClick={() => void load()}>Comprobar</button></div>
          <div className="serviceGrid">{Object.entries(data.health.checks).map(([name, check]) => <div className="serviceCard" key={name}><i className={!check.configured || check.reachable === false ? "bad" : "good"} /><div><strong>{name}</strong><span>{checkLabel(check)}</span>{name === "mem0" && check.reachable === false && check.detail && <small>{check.detail}</small>}</div></div>)}</div>

          <section className="dashboardBlock">
            <div className="blockHeader"><h2>ZYRON te avisa</h2><button className="ghostButton" type="button" onClick={() => void load()}>Revisar ahora</button></div>
            {!proactive ? <div className="mutedBox">Preparando avisos proactivos…</div> : proactive.alerts.length ? proactive.alerts.map((alert) => <div className="compactRow" key={alert.id}><span>{alertIcon(alert)}</span><div><strong>{alert.title}</strong><small>{alert.detail}</small><small><b>Acción sugerida:</b> {alert.suggestedAction}</small></div></div>) : <div className="mutedBox">No detecto nada urgente o próximo que requiera tu atención ahora mismo.</div>}
          </section>

          <section className="dashboardBlock">
            <div className="blockHeader"><h2>Avisos en el iPhone</h2><span>{pushState === "active" ? "ACTIVOS" : pushState === "checking" ? "COMPROBANDO" : "PENDIENTES"}</span></div>
            <div className="compactRow"><span>🔔</span><div><strong>{pushState === "active" ? "ZYRON puede avisarte con la app cerrada" : "Notificaciones proactivas"}</strong><small>{pushMessage || "Comprobando este dispositivo…"}</small></div></div>
            <div className="headerActions">
              {pushState !== "active" && <button className="ghostButton" type="button" disabled={pushBusy || pushState === "checking" || pushState === "unsupported" || pushState === "denied"} onClick={() => void enablePush()}>{pushBusy ? "Activando…" : pushState === "needs_install" ? "Cómo instalar ZYRON" : "Activar avisos"}</button>}
              {pushState === "active" && <button className="ghostButton" type="button" disabled={pushBusy} onClick={() => void sendPushTest()}>{pushBusy ? "Enviando…" : "Enviar prueba"}</button>}
              <button className="ghostButton" type="button" disabled={pushBusy} onClick={() => void inspectPush()}>Comprobar</button>
            </div>
          </section>

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
                    : `Calendar: ${calendarAuthorized ? "autorizado" : "falta permiso"} · Gmail: ${gmailAuthorized ? "lectura autorizada" : "falta autorizar"} · Drive: ${driveAuthorized ? "lectura autorizada" : "falta autorizar"}`}
                </small>
              </div>
            </div>
            {google?.connected && !gmailAuthorized && <div className="mutedBox">Gmail está preparado, pero falta una autorización de Google. Pulsa “Autorizar Gmail” y acepta el permiso de lectura.</div>}
            {google?.connected && !driveAuthorized && <div className="mutedBox">Drive está preparado, pero falta autorizar la lectura. Pulsa “Ampliar permisos Google” y acepta el permiso de Google Drive.</div>}
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
