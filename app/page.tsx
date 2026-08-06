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

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

const initialMessages: Message[] = [{ role: "assistant", content: "Buenas, Aarón. El núcleo privado de ZYRON está activo. Puedo razonar con tu contexto, consultar tu memoria y leer tu agenda conectada." }];
const CHAT_TIMEOUT_MS = 35_000;

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const speechSupported = useMemo(() => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition), []);
  const coreState: CoreState = listening ? "listening" : loading ? "thinking" : speaking ? "speaking" : "ready";
  const coreLabel = { ready: "Núcleo privado activo", listening: "Escuchando", thinking: "Pensando", speaking: "Hablando" }[coreState];

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("zyron-session-messages");
      if (saved) setMessages(JSON.parse(saved) as Message[]);
    } catch { sessionStorage.removeItem("zyron-session-messages"); }
  }, []);

  useEffect(() => {
    sessionStorage.setItem("zyron-session-messages", JSON.stringify(messages.slice(-30)));
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

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
    return spanish.find((voice) => /m[oó]nica|marta|helena|female|mujer/i.test(voice.name)) || spanish.find((voice) => voice.lang.toLowerCase() === "es-es") || spanish[0];
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
        signal: controller.signal,
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      if (!data.reply?.trim()) throw new Error("El núcleo respondió sin texto");
      const reply = data.reply.trim();
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
      else { window.speechSynthesis?.cancel(); setSpeaking(false); recognition.start(); }
    } catch { setListening(false); }
  }
  function clearConversation() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setMessages(initialMessages);
    sessionStorage.removeItem("zyron-session-messages");
  }
  async function logout() {
    window.speechSynthesis?.cancel();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className={`status state-${coreState}`}>● {coreLabel}</div></div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/briefing">Briefing</a>
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
        <p className="subtitle">Conversación con memoria, voz, tareas y Google Calendar.</p>
        <div className="voiceBar">
          <button type="button" className={`orb ${coreState !== "ready" ? coreState : ""}`} onClick={toggleListening} disabled={!speechSupported || loading} aria-label={listening ? "Detener escucha" : "Hablar con ZYRON"}>
            {listening ? "■" : loading ? "…" : speaking ? "◖" : "●"}
          </button>
          <div>
            <strong>{listening ? "Te escucho…" : loading ? "Estoy pensando…" : speaking ? "Te respondo…" : speechSupported ? "Toca el núcleo para hablar" : "Voz no disponible"}</strong>
            <div className="voiceHint">Las consultas se detienen automáticamente si el servidor tarda demasiado.</div>
          </div>
          <button type="button" className="voiceToggle" onClick={() => setVoiceEnabled((value) => !value)}>{voiceEnabled ? "🔊 Voz activa" : "🔇 Voz silenciada"}</button>
        </div>
        <div className="chat" aria-live="polite">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`bubble ${message.role}`}>{message.content}</div>)}
          {loading && <div className="bubble assistant">Pensando…</div>}
          <div ref={chatEndRef} />
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <input aria-label="Mensaje para ZYRON" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Habla o escribe a ZYRON" autoComplete="off" />
          <button type="submit" disabled={loading || !input.trim()}>Enviar</button>
        </form>
        <div className="note">Acceso exclusivo para Aarón. Las claves y la memoria permanecen en el servidor.</div>
      </section>
    </main>
  );
}
