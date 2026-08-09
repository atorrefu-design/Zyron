"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  dispatchNativeAction,
  executeZyronRequest,
  userFacingTextForBlockedAction,
  waitForNativeActionResult,
} from "../lib/client/action-client";
import RealtimeVoice, { type RealtimeVoiceState } from "./realtime-voice";

type Message = { role: "user" | "assistant"; content: string };
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
  content: "Buenas, Aarón. El núcleo privado de ZYRON está activo. Puedes hablar conmigo en tiempo real o escribirme.",
}];
const CHAT_TIMEOUT_MS = 35_000;
const quickPrompts = ["Ponme al día", "¿Qué tengo hoy?", "¿A qué hora tengo que salir?", "¿Cuál es mi próximo evento?", "¿Qué tareas tengo pendientes?"];
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
  const lines = selected.map((alert, index) => `${index + 1}. ${alert.title}\n   ${alert.detail}\n   Te propongo: ${alert.suggestedAction}`);
  return `Aarón, antes de que me preguntes nada he detectado ${selected.length} asunto${selected.length === 1 ? "" : "s"} que conviene mirar:\n${lines.join("\n")}`;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<RealtimeVoiceState>("ready");
  const [pendingCalendar, setPendingCalendar] = useState<PendingCalendarCommand | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingCalendarChoice | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const coreState: CoreState = loading || voiceState === "connecting" || voiceState === "thinking"
    ? "thinking"
    : voiceState === "listening"
      ? "listening"
      : voiceState === "speaking"
        ? "speaking"
        : "ready";
  const coreLabel = {
    ready: "Núcleo privado activo",
    listening: "Conversación activa · escuchando",
    thinking: "Pensando",
    speaking: "Conversación activa · hablando",
  }[coreState];

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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

    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    try {
      let reply: string;
      if (pendingChoice && isCancellation(clean)) {
        setPendingChoice(null);
        reply = "De acuerdo. He cancelado la selección y no he cambiado nada en tu calendario.";
      } else if (pendingChoice) {
        const selected = selectedChoice(clean, pendingChoice);
        reply = selected
          ? await runCalendarCommand(clean, { eventId: selected.id, originalMessage: pendingChoice.originalMessage })
          : `Indica un número entre 1 y ${pendingChoice.events.length}, o di “cancela”.`;
      } else if (pendingCalendar && isCancellation(clean)) {
        setPendingCalendar(null);
        reply = "De acuerdo. He cancelado la operación y no he cambiado nada en tu calendario.";
      } else if (pendingCalendar && isConfirmation(clean)) {
        reply = await runCalendarCommand(clean, { eventId: pendingCalendar.eventId, confirmation: true, originalMessage: pendingCalendar.originalMessage });
      } else if (pendingCalendar) {
        setPendingCalendar(null);
        reply = "He descartado la operación pendiente. Dime la nueva instrucción completa y la ejecutaré desde cero.";
      } else if (isBriefingQuery(clean)) {
        reply = await runBriefing();
      } else if (isCalendarManagementCommand(clean)) {
        reply = await runCalendarCommand(clean);
      } else {
        const deviceLocation = isMobilityQuery(clean) ? await currentDeviceLocation() : null;
        const data = await executeZyronRequest(
          { messages: nextMessages, deviceLocation },
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
          else if (data.reply?.trim()) reply = data.reply.trim();
          else throw new Error(data.error || "El núcleo respondió sin resultado");
        }
      }
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "La consulta ha tardado demasiado y la he detenido. Prueba de nuevo en unos segundos."
        : error instanceof Error && error.message
          ? `No he podido responder: ${error.message}.`
          : "He perdido temporalmente la conexión con el núcleo remoto. Vuelve a intentarlo en unos segundos.";
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
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className={`status state-${coreState}`}>● {coreLabel}</div></div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/briefing">Briefing</a>
          <a className="ghostButton navLink" href="/calendar">Calendar</a>
          <a className="ghostButton navLink" href="/maps">Movilidad</a>
          <a className="ghostButton navLink" href="/dashboard">Panel</a>
          <a className="ghostButton navLink" href="/goals">Objetivos</a>
          <a className="ghostButton navLink" href="/tasks">Tareas</a>
          <a className="ghostButton navLink" href="/activity">Actividad</a>
          <button type="button" className="ghostButton" onClick={clearConversation}>Limpiar</button>
          <button type="button" className="ghostButton" onClick={logout}>Salir</button>
        </div>
      </header>

      <section className="panel">
        <div className="eyebrow">Sistema privado · Aarón</div>
        <h1>Hablar</h1>
        <p className="subtitle">Conversación de voz en tiempo real, memoria, tareas, alertas, Google Calendar y movilidad con tráfico.</p>
        <div className="voiceBar">
          <RealtimeVoice
            disabled={loading}
            onStateChange={setVoiceState}
            onUserTranscript={(text) => setMessages((current) => [...current, { role: "user", content: text }])}
            onAssistantTranscript={(text) => setMessages((current) => [...current, { role: "assistant", content: text }])}
            onError={(message) => setMessages((current) => [...current, { role: "assistant", content: `Voz: ${message}` }])}
          />
        </div>
        <div className="headerActions" aria-label="Consultas rápidas">
          {quickPrompts.map((prompt) => <button className="ghostButton" type="button" key={prompt} disabled={loading} onClick={() => void sendText(prompt)}>{prompt}</button>)}
        </div>
        <div className="chat" aria-live="polite">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`bubble ${message.role}`}>{message.content}</div>)}
          {loading && <div className="bubble assistant">Pensando…</div>}
          <div ref={chatEndRef} />
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <input aria-label="Mensaje para ZYRON" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ej.: Ponme al día" autoComplete="off" />
          <button type="submit" disabled={loading || !input.trim()}>Enviar</button>
        </form>
        <div className="note">Si inicias voz, el micrófono permanece activo durante esa conversación para poder encadenar turnos e interrumpir a ZYRON. Si escribes, la respuesta se mantiene en texto.</div>
      </section>
    </main>
  );
}