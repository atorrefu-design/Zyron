"use client";

import { useEffect, useState } from "react";

type PlanData = {
  plan: {
    totalPending: number;
    generatedAt: string;
    selected: Array<{
      id: number;
      title: string;
      due_at: string | null;
      priority: "urgent" | "scheduled" | "unscheduled";
    }>;
  };
};

export default function PlanPage() {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/plan", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData((await response.json()) as PlanData);
    } catch {
      setError("No he podido preparar el plan del día.");
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
          <div className="status">● Planificador activo</div>
        </div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Hablar</a>
          <a className="ghostButton navLink" href="/dashboard">Panel</a>
          <a className="ghostButton navLink" href="/tasks">Tareas</a>
        </div>
      </header>

      <section className="panel tasksPanel">
        <div className="eyebrow">Prioridades del día</div>
        <h1>Mi plan</h1>
        <p className="subtitle">ZYRON ordena tus pendientes por urgencia, fecha y antigüedad.</p>

        <button className="ghostButton" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Preparando…" : "Recalcular plan"}
        </button>

        {error && <div className="taskError">{error}</div>}
        {loading && !data && <div className="taskEmpty">Ordenando el tablero…</div>}

        {data && (
          <div className="taskList" style={{ marginTop: 18 }}>
            {data.plan.selected.length ? data.plan.selected.map((task, index) => (
              <div className="taskItem" key={task.id}>
                <div className="taskCheck">{index + 1}</div>
                <div className="taskBody">
                  <strong>{task.title}</strong>
                  <span>
                    {task.priority === "urgent" ? "Prioridad alta" : task.priority === "scheduled" ? "Con fecha" : "Sin fecha"}
                    {task.due_at ? ` · ${new Date(task.due_at).toLocaleString("es-ES")}` : ""}
                  </span>
                </div>
              </div>
            )) : <div className="taskEmpty">No tienes tareas pendientes. El tablero respira tranquilo.</div>}

            <div className="note">
              Mostrando {data.plan.selected.length} de {data.plan.totalPending} tareas pendientes. Generado el {new Date(data.plan.generatedAt).toLocaleString("es-ES")}.
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
