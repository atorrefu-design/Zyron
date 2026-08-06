"use client";

import { useEffect, useState } from "react";

type BriefingData = {
  reply: string;
  generatedAt: string;
  limitations: string[];
  health: { ok: boolean; version: string };
  recentActions: Array<{ id: number; summary: string; tool: string; created_at: string }>;
};

export default function BriefingPage() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/briefing", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData((await response.json()) as BriefingData);
    } catch {
      setError("No he podido preparar el briefing ahora mismo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">ZYRON</div>
          <div className="status">● Briefing del propietario</div>
        </div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Hablar</a>
          <a className="ghostButton navLink" href="/dashboard">Panel</a>
          <a className="ghostButton navLink" href="/plan">Plan</a>
        </div>
      </header>

      <section className="panel">
        <div className="eyebrow">Resumen operativo</div>
        <h1>Briefing</h1>
        <p className="subtitle">Prioridades, estado del núcleo y límites actuales en una sola lectura.</p>

        {error && <div className="taskError">{error}</div>}
        {!data && !error && <div className="taskEmpty">Preparando briefing…</div>}

        {data && (
          <>
            <div className="briefingCard">
              <pre className="briefingText">{data.reply}</pre>
              <div className="note">
                Generado {new Date(data.generatedAt).toLocaleString("es-ES")} · Núcleo {data.health.version}
              </div>
            </div>

            {data.recentActions.length > 0 && (
              <div className="briefingCard">
                <h2>Últimos movimientos</h2>
                {data.recentActions.map((item) => (
                  <div className="compactRow" key={item.id}>
                    <span>•</span>
                    <div>
                      <strong>{item.summary}</strong>
                      <small>{item.tool} · {new Date(item.created_at).toLocaleString("es-ES")}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button className="voiceToggle" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Actualizando…" : "Actualizar briefing"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
