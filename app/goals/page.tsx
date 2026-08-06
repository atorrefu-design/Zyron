"use client";

import { FormEvent, useEffect, useState } from "react";
import "./goals.css";

type Goal = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  description: string | null;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/goals", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { goals: Goal[] };
      setGoals(data.goals);
    } catch {
      setError("No he podido cargar los objetivos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!response.ok) throw new Error();
      setName("");
      setDescription("");
      await load();
    } catch {
      setError("No he podido crear el objetivo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className="status">● Objetivos activos</div></div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Hablar</a>
          <a className="ghostButton navLink" href="/dashboard">Panel</a>
          <a className="ghostButton navLink" href="/tasks">Tareas</a>
        </div>
      </header>

      <section className="panel goalsPanel">
        <div>
          <div className="eyebrow">Dirección y progreso</div>
          <h1>Objetivos</h1>
          <p className="subtitle">Agrupa tareas bajo metas mayores y comprueba cuánto terreno has ganado.</p>
        </div>

        <form className="goalComposer" onSubmit={create}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nuevo objetivo" maxLength={100} />
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descripción opcional" maxLength={500} />
          <button type="submit" disabled={saving || !name.trim()}>{saving ? "Creando…" : "Crear"}</button>
        </form>

        {error && <div className="taskError">{error}</div>}
        {loading && <div className="taskEmpty">Cargando objetivos…</div>}

        {!loading && (
          <div className="goalGrid">
            {goals.map((goal) => (
              <article className="goalCard" key={goal.id}>
                <div className="goalTop">
                  <span className="goalIcon">{goal.icon || "🎯"}</span>
                  <div><h2>{goal.name}</h2><p>{goal.description || "Sin descripción"}</p></div>
                  <strong>{goal.progress}%</strong>
                </div>
                <div className="progressTrack"><span style={{ width: `${Math.max(0, Math.min(goal.progress, 100))}%` }} /></div>
                <div className="goalMeta">
                  <span>{goal.completed_tasks} completadas</span>
                  <span>{goal.total_tasks - goal.completed_tasks} pendientes</span>
                  <span>{goal.total_tasks} tareas</span>
                </div>
              </article>
            ))}
            {!goals.length && <div className="taskEmpty">Todavía no hay objetivos.</div>}
          </div>
        )}
      </section>
    </main>
  );
}
