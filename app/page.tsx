"use client";
import { queueJournal, flushJournal } from "../lib/client/journal";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  dispatchNativeAction,
  executeZyronRequest,
  userFacingTextForBlockedAction,
  waitForNativeActionResult,
} from "../lib/client/action-client";
import RealtimeVoice, { type RealtimeVoiceState } from "./realtime-voice";

type Message = { role: "user" | "assistant"; content: string; engine?: "OpenAI" | "Claude" | "Gemini" | "Local" };
type CoreState = "ready" | "listening" | "thinking" | "speaking";
type PendingCalendarCommand = { originalMessage: string; eventId: string };
type PendingCalendarChoice = { originalMessage: string; events: Array<{ id: string; title?: string }> };
type CalendarCommandResponse = {
  reply?: string;
  error?: string;
  action?: string;
  event?: { id: string };
  events?: Array<{ id: string; title?: string }>;
};
type ProactiveAlert = {
  id: string;
  severity: "alta" | "media" | "baja";
  source: "system" | "tasks" | "calendar" | "gmail" | "maps";
  title: string;
  detail: string;
  suggestedAction: string;
};
type ProactiveResponse = { alerts?: ProactiveAlert[] };
type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

const initialMessages: Message[] = [{
  role: "assistant",
  content: "A su disposición, señor. ¿En qué puedo ayudarle?",
}];
const CHAT_TIMEOUT_MS = 35_000;
const quickPrompts = ["Ponme al día", "¿Qué tengo hoy?", "¿Qué tiempo hará?", "Prepara mi plan del día", "¿Qué correos requieren atención?"];
const PENDING_KEY = "zyron-pending-calendar-command";
const CHOICE_KEY = "zyron-pending-calendar-choice";
const PROACTIVE_KEY = "zyron-proactive-shown";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isCalendarManagementCommand(message: string) {
  const clean = normalize(message);
  return /\b(anade|crea|apunta|agenda|programa|mueve|cambia|pasa|reprograma|modifica|edita|borra|elimina|cancela)\b/.test(clean)
    && /\b(evento|cita|reunion|dentista|medico|entrenamiento|partido|llamada|visita|calendario|agenda|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2}[:.]\d{2})\b/.test(clean);
}

function isMobilityQuery(message: string) {
  const clean = normalize(message);
  return /\b(trafico|ruta|trayecto|cuanto tardo|cuanto tardare|hora de salir|hora tengo que salir|cuando tengo que salir|cuando debo salir|a que hora salgo|a que hora tengo que salir|llego a tiempo|llegare a tiempo|salida recomendada)\b/.test(clean);
}

function isBriefingQuery(message: string) {
  const clean = normalize(message).replace(/\s+/g, " ").trim();
  return /\b(ponme al dia|ponme al corriente|briefing|resumeme el dia|resumen del dia|como tengo el dia|que necesito saber ahora|que deberia saber ahora|que es importante hoy)\b/.test(clean);
}

function currentDeviceLocation() {
  return new Promise<DeviceLocation | null>((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  });
}

function isConfirmation(message: string) {
  return /^(si|confirmo|confirma|adelante|hazlo|correcto|vale)$/i.test(normalize(message).trim());
}

function isCancellation(message: string) {
  return /^(no|cancela|cancelar|dejalo|dejalo estar|olvidalo|para)$/i.test(normalize(message).trim());
}

function selectedChoice(message: string, choices: PendingCalendarChoice) {
  const match = normalize(message).trim().match(/^(?:el|la|opcion)?\s*(\d{1,2})$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return choices.events[index] ?? null;
}

function proactiveMessage(alerts: ProactiveAlert[]) {
  const selected = alerts.filter((alert) => alert.severity === "alta").slice(0, 3);
  if (!selected.length) return null;
  const lines = selected.map((alert, index) => `${index + 1}. ${alert.title}\n   ${alert.detail}\n   Le propongo: ${alert.suggestedAction}`);
  return `Señor, he detectado ${selected.length} asunto${selected.length === 1 ? "" : "s"} que conviene mirar:\n${lines.join("\n")}`;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [allowAI, setAllowAI] = useState(true);
  const [historyStatus, setHistoryStatus] = useState("Historial automático activado.");
  useEffect(() => {
    const status = (event: Event) => setHistoryStatus((event as CustomEvent<string>).detail);
    const online = () => { void flushJournal(); };
    window.addEventListener("zyron:history-status", status);
    window.addEventListener("online", online);
    void flushJournal();
    return () => { window.removeEventListener("zyron:history-status", status); window.removeEventListener("online", online); };
  }, []);
  const [readAloud, setReadAloud] = useState(false);
  const [health, setHealth] = useState<Record<string, { configured: boolean; reachable: boolean | null }> | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [motion, setMotion] = useState(true);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<RealtimeVoiceState>("ready");
  const [pendingCalendar, setPendingCalendar] = useState<PendingCalendarCommand | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingCalendarChoice | null>(null);
  const [clock, setClock] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const coreState: CoreState = loading || voiceState === "connecting" || voiceState === "thinking"
    ? "thinking"
    : voiceState === "listening"
      ? "listening"
      : voiceState === "speaking"
        ? "speaking"
        : "ready";
  const coreLabel = {
    ready: health ? (health.database?.reachable && health.memory?.reachable ? "Conectado al núcleo" : "Núcleo con incidencias") : healthError ? "Sin conexión verificada" : "Comprobando conexión",
    listening: "Conversación activa · escuchando",
    thinking: "Pensando",
    speaking: "Conversación activa · hablando",
  }[coreState];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const data = await r.json(); if (!data.checks) throw new Error(); return data; })
      .then((data) => setHealth(data.checks || null))
      .catch((e) => { if (e.name !== "AbortError") setHealthError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const updateClock = () => setClock(new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "short",
    }).format(new Date()));
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("zyron-session-messages");
      if (saved) setMessages(JSON.parse(saved) as Message[]);
      const pending = sessionStorage.getItem(PENDING_KEY);
      if (pending) setPendingCalendar(JSON.parse(pending) as PendingCalendarCommand);
      const choice = sessionStorage.getItem(CHOICE_KEY);
      if (choice) setPendingChoice(JSON.parse(choice) as PendingCalendarChoice);
    } catch {
      sessionStorage.removeItem("zyron-session-messages");
      sessionStorage.removeItem(PENDING_KEY);
      sessionStorage.removeItem(CHOICE_KEY);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (sessionStorage.getItem(PROACTIVE_KEY)) return;
        const response = await fetch("/api/alerts", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as ProactiveResponse;
        const message = proactiveMessage(data.alerts ?? []);
        sessionStorage.setItem(PROACTIVE_KEY, new Date().toISOString());
        if (!message || cancelled) return;
        queueJournal("assistant", message);
      setMessages((current) => [...current, { role: "assistant", content: message }]);
      } catch {
        // Proactivity must never block normal conversation.
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    sessionStorage.setItem("zyron-session-messages", JSON.stringify(messages.slice(-30)));
    if (messages.length > initialMessages.length || loading) chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    if (pendingCalendar) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingCalendar));
    else sessionStorage.removeItem(PENDING_KEY);
  }, [pendingCalendar]);

  useEffect(() => {
    if (pendingChoice) sessionStorage.setItem(CHOICE_KEY, JSON.stringify(pendingChoice));
    else sessionStorage.removeItem(CHOICE_KEY);
  }, [pendingChoice]);

  async function runCalendarCommand(message: string, options?: { eventId?: string; confirmation?: boolean; originalMessage?: string }) {
    const response = await fetch("/api/calendar/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options?.originalMessage || message,
        eventId: options?.eventId,
        confirmation: Boolean(options?.confirmation),
      }),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as CalendarCommandResponse;
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    if (!data.reply?.trim()) throw new Error("Calendar respondió sin texto");

    if (data.action === "ambiguous" && data.events?.length) {
      setPendingChoice({ originalMessage: message, events: data.events });
      setPendingCalendar(null);
    } else if (data.action === "confirmation_required" && data.event?.id) {
      setPendingCalendar({ originalMessage: options?.originalMessage || message, eventId: data.event.id });
      setPendingChoice(null);
    } else {
      setPendingCalendar(null);
      setPendingChoice(null);
    }
    return data.reply.trim();
  }

  async function runBriefing() {
    const response = await fetch("/api/briefing", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    if (!data.reply?.trim()) throw new Error("El briefing respondió sin texto");
    return data.reply.trim();
  }

  async function sendText(text: string) {
    const clean = text.trim();
    if (!clean || loading) return;

    queueJournal("user", clean);
    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    try {
      let reply: string;
      let engine: Message["engine"];
      if (!allowAI && (pendingChoice || pendingCalendar)) {
        setPendingChoice(null); setPendingCalendar(null);
        reply = "Señor, he cancelado la operación pendiente al entrar en modo sin IA. Para interpretar fechas en lenguaje natural, active Conversación con IA.";
      } else if (pendingChoice && isCancellation(clean)) {
        setPendingChoice(null);
        reply = "De acuerdo. He cancelado la selección y no he cambiado nada en su calendario.";
      } else if (pendingChoice) {
        const selected = selectedChoice(clean, pendingChoice);
        reply = selected
          ? await runCalendarCommand(clean, { eventId: selected.id, originalMessage: pendingChoice.originalMessage })
          : `Indique un número entre 1 y ${pendingChoice.events.length}, o di “cancela”.`;
      } else if (pendingCalendar && isCancellation(clean)) {
        setPendingCalendar(null);
        reply = "De acuerdo. He cancelado la operación y no he cambiado nada en su calendario.";
      } else if (pendingCalendar && isConfirmation(clean)) {
        reply = await runCalendarCommand(clean, { eventId: pendingCalendar.eventId, confirmation: true, originalMessage: pendingCalendar.originalMessage });
      } else if (pendingCalendar) {
        setPendingCalendar(null);
        reply = "He descartado la operación pendiente. Indíqueme la nueva instrucción completa y la ejecutaré desde cero.";
      } else if (isBriefingQuery(clean)) {
        reply = await runBriefing();
      } else if (allowAI && isCalendarManagementCommand(clean)) {
        reply = await runCalendarCommand(clean);
      } else {
        const deviceLocation = isMobilityQuery(clean) || /\b(tiempo|clima|lluvia|temperatura|prevision|pronostico)\b/.test(normalize(clean))
          ? await currentDeviceLocation()
          : null;
        const data = await executeZyronRequest(
          { messages: nextMessages, deviceLocation, allowAI },
          { signal: controller.signal },
        );

        if (data.mode === "native_execute" && data.action) {
          // Subscribe before dispatching so a very fast native executor cannot race
          // the browser and emit its result before the listener exists.
          const nativeResultPromise = waitForNativeActionResult(data.action, {
            timeoutMs: 30_000,
            signal: controller.signal,
          });
          const acceptedByNative = dispatchNativeAction(data);
          if (!acceptedByNative) {
            void nativeResultPromise.catch(() => undefined);
            reply = "Esta acción necesita el companion nativo de ZYRON en el iPhone.";
          } else {
            const nativeResult = await nativeResultPromise;
            if (!nativeResult.handled) {
              throw new Error("El companion no reconoce todavía esta acción");
            }
            if (!nativeResult.succeeded) {
              throw new Error(nativeResult.reply || "El iPhone no ha podido completar la acción");
            }
            reply = nativeResult.reply?.trim() || "Hecho.";
          }
        } else {
          const blocked = userFacingTextForBlockedAction(data);
          if (blocked) reply = blocked;
          else if (data.reply?.trim()) {
            reply = data.reply.trim();
            engine = data.provider === "claude" ? "Claude" : data.provider === "gemini" ? "Gemini" : data.provider === "openai" ? "OpenAI" : data.provider === "local" ? "Local" : undefined;
          }
          else throw new Error(data.error || "El núcleo respondió sin resultado");
        }
      }
      queueJournal("assistant", reply);
      setMessages((current) => [...current, { role: "assistant", content: reply, engine }]);
      if (readAloud && (voiceState === "ready" || voiceState === "error") && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(reply);
        utterance.lang = "es-ES"; utterance.rate = 0.96;
        const voice = window.speechSynthesis.getVoices().find((v) => v.lang === "es-ES" && v.localService);
        if (voice) utterance.voice = voice;
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "La consulta ha tardado demasiado y la he detenido. Prueba de nuevo en unos segundos."
        : error instanceof Error && error.message
          ? `No he podido responder: ${error.message}.`
          : "He perdido temporalmente la conexión con el núcleo remoto. Vuelve a intentarlo en unos segundos.";
      queueJournal("assistant", message);
      setMessages((current) => [...current, { role: "assistant", content: message }]);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    void sendText(input);
  }

  function clearConversation() {
    setPendingCalendar(null);
    setPendingChoice(null);
    setMessages(initialMessages);
    sessionStorage.removeItem("zyron-session-messages");
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(CHOICE_KEY);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  return (
    <main className={`shell jarvisShell ${motion ? "" : "motionOff"}`}>
      <header className="header">
        <div><div className="brand">ZYRON</div><div className={`status state-${coreState}`}>● {coreLabel}</div></div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/briefing">Briefing</a>
          <a className="ghostButton navLink" href="/calendar">Calendar</a>
          <a className="ghostButton navLink" href="/maps">Movilidad</a>
          <a className="ghostButton navLink" href="/connections">Conexiones</a>
          <a className="ghostButton navLink" href="/goals">Objetivos</a>
          <a className="ghostButton navLink" href="/tasks">Tareas</a>
          <a className="ghostButton navLink" href="/memory">Memoria</a>
          <a className="ghostButton navLink" href="/channels">Canales</a>
          <a className="ghostButton navLink" href="/activity">Actividad</a>
          <button type="button" className="ghostButton" onClick={clearConversation}>Limpiar pantalla</button>
          <button type="button" className="ghostButton" onClick={logout}>Salir</button>
        </div>
      </header>

      <section className="panel commandPanel">
        <div className="commandHeader">
          <div><div className="eyebrow">ZYRON / PERSONAL OPERATING SYSTEM</div><h1>A su disposición, señor.</h1></div>
          <div className="systemClock"><span>EUROPE / MADRID</span><strong>{clock || "--:--"}</strong></div>
        </div>
        <p className="subtitle">Su memoria, sus herramientas y su conversación. Un único núcleo, esté donde esté.</p>
        <div className="systemsRail" aria-label="Estado comprobado de sistemas">
          {[['database', 'Núcleo'], ['memory', 'Memoria'], ['openai', 'API OpenAI'], ['maps', 'Mapas']].map(([key, label]) => {
            const check = health?.[key];
            const state = !check ? 'Sin verificar' : !check.configured ? 'Sin conectar' : check.reachable === true ? 'Disponible' : check.reachable === false ? 'Incidencia' : 'Configurado';
            return <span key={key} data-ok={check?.reachable === true}><i />{label} · {state}</span>;
          })}
        </div>
        <div role="status" className="historyStatus"><a href="/history">Historial compartido</a> · {historyStatus} <button className="ghostButton" onClick={() => void flushJournal()}>Reintentar sincronización</button></div>
        <div className={`hologram state-${coreState}`} aria-hidden="true">
          <svg viewBox="0 0 600 400" className="holoSvg">
            <defs><radialGradient id="coreGlow"><stop stopColor="#95f8ff" stopOpacity=".65"/><stop offset="1" stopColor="#00ccff" stopOpacity="0"/></radialGradient></defs>
            <path d="M0 200H130M470 200H600M300 0V45M300 355V400" stroke="#1f5869" fill="none"/>
            <circle cx="300" cy="200" r="150" fill="url(#coreGlow)"/>
            <g className="holoOuter"><circle cx="300" cy="200" r="157" fill="none" stroke="#38b6ca" strokeWidth="1" strokeDasharray="2 8"/><circle cx="300" cy="200" r="140" fill="none" stroke="#75edff" strokeWidth="3" strokeDasharray="150 40 10 25"/></g>
            <g className="holoInner"><circle cx="300" cy="200" r="114" fill="none" stroke="#2197b0" strokeWidth="16" strokeDasharray="2 8"/><circle cx="300" cy="200" r="93" fill="none" stroke="#8cedff" strokeWidth="2" strokeDasharray="160 130"/></g>
            <circle cx="300" cy="200" r="73" fill="#05121c" stroke="#4edcf6"/>
            <path d="M270 168H332L271 233H333" fill="none" stroke="#b4f7ff" strokeWidth="3"/>
            <text x="300" y="300" textAnchor="middle" fill="#a3dce7" fontSize="9" letterSpacing="5">ZYRON CORE</text>
          </svg>
          <div className="holoCaption"><span>{coreLabel}</span><small>INTERFAZ PERSONAL · {allowAI ? 'CONVERSACIÓN' : 'ÓRDENES DIRECTAS'}</small></div>
        </div>
        <div className="modeToolbar">
          <label><input type="checkbox" checked={allowAI} disabled={voiceState !== 'ready' && voiceState !== 'error'} onChange={(e) => setAllowAI(e.target.checked)} /> Conversación con IA</label>
          <label><input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} /> Leer respuestas con voz del dispositivo</label>
          <button type="button" className="ghostButton" onClick={() => setMotion(!motion)}>{motion ? 'Pausar animación' : 'Animar núcleo'}</button>
          <button type="button" className="ghostButton" onClick={() => window.speechSynthesis?.cancel()}>Silenciar lectura</button>
        </div>
        <div className="voiceBar">
          <RealtimeVoice
            disabled={loading || !allowAI}
            onStateChange={(state) => { setVoiceState(state); if (state !== "ready" && state !== "error") window.speechSynthesis?.cancel(); }}
            onUserTranscript={(text) => setMessages((current) => [...current, { role: "user", content: text }])}
            onAssistantTranscript={(text) => setMessages((current) => [...current, { role: "assistant", content: text }])}
            onError={(message) => setMessages((current) => [...current, { role: "assistant", content: `Voz: ${message}` }])}
          />
        </div>
        <div className="capabilityDeck">
          <a href="/calendar"><span>AGENDA</span><strong>Eventos y planificación</strong></a>
          <a href="/briefing"><span>INTEL</span><strong>Briefing contextual</strong></a>
          <a href="/maps"><span>MOVILIDAD</span><strong>Rutas y tráfico</strong></a>
          <a href="/dashboard"><span>SISTEMAS</span><strong>Estado y herramientas</strong></a>
        </div>
        <div className="headerActions quickPrompts" aria-label="Consultas rápidas">
          {quickPrompts.map((prompt) => <button className="ghostButton" type="button" key={prompt} disabled={loading} onClick={() => void sendText(prompt)}>{prompt}</button>)}
        </div>
        <div className="chat" aria-live="polite">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
              <div className="messageIdentity">{message.role === "assistant" ? "ZYRON" : "AARÓN"}</div>
              <div>{message.content}</div>
              {message.engine && <small className="engineBadge">Motor · {message.engine}</small>}
            </div>
          ))}
          {loading && <div className="bubble assistant">Pensando…</div>}
          <div ref={chatEndRef} />
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <input aria-label="Mensaje para ZYRON" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ej.: Ponme al día" autoComplete="off" />
          <button type="submit" disabled={loading || !input.trim()}>Enviar</button>
        </form>
        <div className="note">Voz continua con IA · Micrófono activo solo durante la sesión · Órdenes directas disponibles sin modelo generativo.</div>
      </section>
    </main>
  );
}
