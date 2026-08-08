"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
type CoreState = "ready" | "listening" | "thinking" | "speaking";
type SpeechRecognitionEventLike = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
};
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

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

const initialMessages: Message[] = [{ role: "assistant", content: "Buenas, Aarón. El núcleo privado de ZYRON está activo. Puedo razonar con tu contexto, consultar tu memoria y gestionar tu agenda conectada." }];
const CHAT_TIMEOUT_MS = 35_000;
const quickPrompts = ["¿Qué tengo hoy?", "¿A qué hora tengo que salir?", "¿Cuál es mi próximo evento?", "¿Qué tareas tengo pendientes?"];
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
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [pendingCalendar, setPendingCalendar] = useState<PendingCalendarCommand | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingCalendarChoice | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const speechSupported = useMemo(() => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition), []);
  const coreState: CoreState = listening ? "listening" : loading ? "thinking" : speaking ? "speaking" : "ready";
  const coreLabel = { ready: "Núcleo privado activo", listening: "Escuchando", thinking: "Pensando", speaking: "Hablando" }[coreState];

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

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) void sendText(transcript);
    };
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  function chooseSpanishVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    const spanish = voices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
    return spanish.find((voice) => /m[oó]nica|marta|helena|female|mujer/i.test(voice.name))
      || spanish.find((voice) => voice.lang.toLowerCase() === "es-es")
      || spanish[0];
  }

  function speak(text: string) {
    if (!text || !voiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.98;
    utterance.pitch = 0.82;
    utterance.voice = chooseSpanishVoice() || null;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

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
        if (!selected) {
          reply = `Indica un número entre 1 y ${pendingChoice.events.length}, o di “cancela”.`;
        } else {
          reply = await runCalendarCommand(clean, { eventId: selected.id, originalMessage: pendingChoice.originalMessage });
        }
      } else if (pendingCalendar && isCancellation(clean)) {
        setPendingCalendar(null);
        reply = "De acuerdo. He cancelado la operación y no he cambiado nada en tu calendario.";
      } else if (pendingCalendar && isConfirmation(clean)) {
        reply = await runCalendarCommand(clean, { eventId: pendingCalendar.eventId, confirmation: true, originalMessage: pendingCalendar.originalMessage });
      } else if (pendingCalendar) {
        setPendingCalendar(null);
        reply = "He descartado la operación pendiente. Dime la nueva instrucción completa y la ejecutaré desde cero.";
      } else if (isCalendarManagementCommand(clean)) {
        reply = await runCalendarCommand(clean);
      } else {
        const deviceLocation = isMobilityQuery(clean) ? await currentDeviceLocation() : null;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages, deviceLocation }),
          signal: controller.signal,
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
        if (!data.reply?.trim()) throw new Error("El núcleo respondió sin texto");
        reply = data.reply.trim();
      }
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "La consulta ha tardado demasiado y la he detenido. Prueba de nuevo en unos segundos."
        : error instanceof Error && error.message
          ? `No he podido responder: ${error.message}.`
          : "He perdido temporalmente la conexión con el núcleo remoto. Vuelve a intentarlo en unos segundos.";
      setMessages((current) => [...current, { role: "assistant", content: message }]);
      speak(message);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  function sendMessage(event: FormEvent) { event.preventDefault(); void sendText(input); }

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition || loading) return;
    try {
      if (listening) recognition.stop();
      else {
        window.speechSynthesis?.cancel();
        setSpeaking(false);
        recognition.start();
      }
    } catch {
      setListening(false);
    }
  }

  function clearConversation() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setPendingCalendar(null);
    setPendingChoice(null);
    setMessages(initialMessages);
    sessionStorage.removeItem("zyron-session-messages");
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(CHOICE_KEY);
  }

  async function logout() {
    window.speechSynthesis.cancel();
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
        <p className="subtitle">Conversación con memoria, voz, tareas, alertas, Google Calendar y movilidad con tráfico.</p>
        <div className="voiceBar">
          <button type="button" className={`orb ${coreState !== "ready" ? coreState : ""}`} onClick={toggleListening} disabled={!speechSupported || loading} aria-label={listening ? "Detener escucha" : "Hablar con ZYRON"}>
            {listening ? "■" : loading ? "…" : speaking ? "◖" : "●"}
          </button>
          <div>
            <strong>{listening ? "Te escucho…" : loading ? "Estoy pensando…" : speaking ? "Te respondo…" : speechSupported ? "Toca el núcleo para hablar" : "Voz no disponible"}</strong>
            <div className="voiceHint">ZYRON revisa tareas, agenda, correo, tráfico y salud del núcleo para avisarte si detecta algo prioritario.</div>
          </div>
          <button type="button" className="voiceToggle" onClick={() => setVoiceEnabled((value) => !value)}>{voiceEnabled ? "🔊 Voz activa" : "🔇 Voz silenciada"}</button>
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
          <input aria-label="Mensaje para ZYRON" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ej.: ¿A qué hora tengo que salir?" autoComplete="off" />
          <button type="submit" disabled={loading || !input.trim()}>Enviar</button>
        </form>
        <div className="note">Acceso exclusivo para Aarón. En consultas de movilidad, la ubicación actual se envía solo para calcular esa respuesta y no se guarda como historial de localización.</div>
      </section>
    </main>
  );
}
