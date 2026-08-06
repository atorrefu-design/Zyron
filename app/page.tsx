"use client";

import { FormEvent, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

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

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages = [...messages, { role: "user" as const, content: text }];
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
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: "He perdido temporalmente la conexión con el núcleo remoto. Vuelve a intentarlo en unos segundos." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">ZYRON</div>
        <div className="status">● Núcleo remoto activo</div>
      </header>

      <section className="panel">
        <div className="eyebrow">Sistema privado · Aarón</div>
        <h1>Hablar</h1>
        <p className="subtitle">Una única conversación, con memoria y continuidad entre sesiones.</p>

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
            placeholder="Habla con ZYRON"
            autoComplete="off"
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Enviar
          </button>
        </form>
        <div className="note">Acceso diseñado exclusivamente para Aarón. La autenticación reforzada será el siguiente blindaje.</div>
      </section>
    </main>
  );
}
