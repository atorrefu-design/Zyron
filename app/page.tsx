"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

type SpeechRecognitionEventLike = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

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

const initialMessages: Message[] = [
  {
    role: "assistant",
    content: "Buenas, Aarón. El núcleo privado de ZYRON está activo. Puedo razonar con tu contexto y consultar tu memoria permanente.",
  },
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const speechSupported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("zyron-session-messages");
      if (saved) setMessages(JSON.parse(saved) as Message[]);
    } catch {
      sessionStorage.removeItem("zyron-session-messages");
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem("zyron-session-messages", JSON.stringify(messages.slice(-30)));
  }, [messages]);

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

  function speak(text: string) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 1;
    utterance.pitch = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  async function sendText(text: string) {
    const clean = text.trim();
    if (!clean || loading) return;

    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!response.ok) throw new Error("No se pudo contactar con el núcleo");
      const data = (await response.json()) as { reply: string };
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
      speak(data.reply);
    } catch {
      const fallback = "He perdido temporalmente la conexión con el núcleo remoto. Vuelve a intentarlo en unos segundos.";
      setMessages((current) => [...current, { role: "assistant", content: fallback }]);
      speak(fallback);
    } finally {
      setLoading(false);
    }
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    void sendText(input);
  }

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition || loading) return;
    try {
      if (listening) recognition.stop();
      else recognition.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">ZYRON</div>
        <div className="status">● Núcleo privado activo</div>
      </header>

      <section className="panel">
        <div className="eyebrow">Sistema privado · Aarón</div>
        <h1>Hablar</h1>
        <p className="subtitle">Conversación con memoria, voz y continuidad durante la sesión.</p>

        <div className="voiceBar">
          <button
            type="button"
            className={`orb ${listening ? "listening" : ""}`}
            onClick={toggleListening}
            disabled={!speechSupported || loading}
            aria-label={listening ? "Detener escucha" : "Hablar con ZYRON"}
          >
            {listening ? "■" : "●"}
          </button>
          <div>
            <strong>{listening ? "Te escucho…" : speechSupported ? "Toca el núcleo para hablar" : "Voz no disponible"}</strong>
            <div className="voiceHint">Las respuestas se leen en voz alta desde el propio iPhone.</div>
          </div>
          <button type="button" className="voiceToggle" onClick={() => setVoiceEnabled((value) => !value)}>
            {voiceEnabled ? "🔊" : "🔇"}
          </button>
        </div>

        <div className="chat" aria-live="polite">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
              {message.content}
            </div>
          ))}
          {loading && <div className="bubble assistant">Pensando…</div>}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            aria-label="Mensaje para ZYRON"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Habla o escribe a ZYRON"
            autoComplete="off"
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Enviar
          </button>
        </form>
        <div className="note">Acceso exclusivo para Aarón. Las claves y la memoria permanecen en el servidor.</div>
      </section>
    </main>
  );
}
