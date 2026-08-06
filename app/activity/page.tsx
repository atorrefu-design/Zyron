"use client";

import { useEffect, useState } from "react";

type ZyronAction = {
  id: number;
  tool: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export default function ActivityPage() {
  const [actions, setActions] = useState<ZyronAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadActions() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/actions?limit=60", { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cargar la actividad");
      const data = (await response.json()) as { actions?: ZyronAction[] };
      setActions(data.actions ?? []);
    } catch {
      setError("No he podido recuperar el historial de acciones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActions();
  }, []);

  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">ZYRON</div>
          <div className="status">● Historial operativo</div>
        </div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Hablar</a>
          <a className="ghostButton navLink" href="/tasks">Tareas</a>
          <button type="button" className="ghostButton" onClick={() => void loadActions()}>Actualizar</button>
        </div>
      </header>

      <section className="panel activityPanel">
        <div className="eyebrow">Trazabilidad privada</div>
        <h1>Actividad</h1>
        <p className="subtitle">Acciones reales ejecutadas por ZYRON sobre tus herramientas.</p>

        {error && <div className="taskError">{error}</div>}
        {loading ? (
          <div className="taskEmpty">Recuperando el cuaderno de bitácora…</div>
        ) : actions.length === 0 ? (
          <div className="taskEmpty">Todavía no hay acciones registradas.</div>
        ) : (
          <div className="activityList">
            {actions.map((item) => (
              <article className="activityItem" key={item.id}>
                <div className="activityIcon">{item.tool === "tasks" ? "✓" : "●"}</div>
                <div className="activityBody">
                  <strong>{item.summary}</strong>
                  <span>{item.tool} · {item.action}</span>
                </div>
                <time dateTime={item.created_at}>
                  {new Intl.DateTimeFormat("es-ES", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(item.created_at))}
                </time>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
