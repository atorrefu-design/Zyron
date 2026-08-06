"use client";

import { useEffect, useState } from "react";

type Goal = {
  id: number;
  name: string;
  icon: string;
  description: string | null;
  progress: number;
};

type Task = {
  id: number;
  title: string;
  due_at: string | null;
  completed: boolean;
};

type GoalDetail = {
  goal: Goal;
  tasks: Task[];
  summary: { total: number; pending: number; completed: number; nextDue: string | null };
};

export default function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<GoalDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void params.then((value) => setId(value.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const response = await fetch(`/api/goals/${id}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        setData((await response.json()) as GoalDetail);
      } catch {
        setError("No he podido cargar este objetivo.");
      }
    })();
  }, [id]);

  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">ZYRON</div>
          <div className="status">● Espacio de objetivo</div>
        </div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/goals">Objetivos</a>
          <a className="ghostButton navLink" href="/tasks">Tareas</a>
          <a className="ghostButton navLink" href="/">Hablar</a>
        </div>
      </header>

      <section className="panel tasksPanel">
        {error && <div className="taskError">{error}</div>}
        {!data && !error && <div className="taskEmpty">Cargando objetivo…</div>}

        {data && (
          <>
            <div className="eyebrow">Objetivo activo</div>
            <h1>{data.goal.icon} {data.goal.name}</h1>
            <p className="subtitle">{data.goal.description || "Sin descripción todavía."}</p>

            <div className="metricGrid">
              <div className="metricCard"><strong>{data.goal.progress}%</strong><span>Progreso</span></div>
              <div className="metricCard"><strong>{data.summary.pending}</strong><span>Pendientes</span></div>
              <div className="metricCard"><strong>{data.summary.completed}</strong><span>Completadas</span></div>
              <div className="metricCard"><strong>{data.summary.total}</strong><span>Total</span></div>
            </div>

            <div className="taskList" style={{ marginTop: 24 }}>
              {data.tasks.length === 0 && <div className="taskEmpty">Este objetivo todavía no tiene tareas vinculadas.</div>}
              {data.tasks.map((task) => (
                <article key={task.id} className={`taskItem ${task.completed ? "done" : ""}`}>
                  <div className="taskCheck" aria-hidden="true">{task.completed ? "✓" : ""}</div>
                  <div className="taskBody">
                    <strong>{task.title}</strong>
                    <span>{task.due_at ? new Date(task.due_at).toLocaleString("es-ES") : "Sin fecha"}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
