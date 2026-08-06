"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Task = {
  id: number;
  title: string;
  due_at: string | null;
  completed: boolean;
  goal_id: number | null;
  created_at: string;
};

type Goal = { id: number; name: string; icon: string };

function formatDue(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [goalId, setGoalId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pendingCount = useMemo(() => tasks.filter((task) => !task.completed).length, [tasks]);

  const loadData = useCallback(async () => {
    try {
      setError("");
      const [tasksResponse, goalsResponse] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }),
        fetch("/api/goals", { cache: "no-store" }),
      ]);
      if (!tasksResponse.ok || !goalsResponse.ok) throw new Error();
      const taskData = (await tasksResponse.json()) as { tasks: Task[] };
      const goalData = (await goalsResponse.json()) as { goals: Goal[] };
      setTasks(taskData.tasks);
      setGoals(goalData.goals);
    } catch {
      setError("No he podido cargar las tareas y objetivos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          goalId: goalId ? Number(goalId) : null,
        }),
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { task: Task };
      setTasks((current) => [data.task, ...current]);
      setTitle("");
      setDueAt("");
      setGoalId("");
    } catch {
      setError("No he podido guardar la tarea.");
    } finally {
      setSaving(false);
    }
  }

  async function patchTask(task: Task, patch: { completed?: boolean; goalId?: number | null }) {
    const optimistic = { ...task, ...(typeof patch.completed === "boolean" ? { completed: patch.completed } : {}), ...(Object.prototype.hasOwnProperty.call(patch, "goalId") ? { goal_id: patch.goalId ?? null } : {}) };
    setTasks((current) => current.map((item) => item.id === task.id ? optimistic : item));
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, ...patch }),
    }).catch(() => null);
    if (!response?.ok) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setError("No he podido actualizar la tarea.");
    }
  }

  async function removeTask(id: number) {
    const previous = tasks;
    setTasks((current) => current.filter((task) => task.id !== id));
    const response = await fetch(`/api/tasks?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      setTasks(previous);
      setError("No he podido eliminar la tarea.");
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className="status">● Tareas persistentes activas</div></div>
        <a className="ghostButton navLink" href="/">Volver</a>
      </header>

      <section className="panel tasksPanel">
        <div className="eyebrow">Panel operativo</div>
        <h1>Tareas</h1>
        <p className="subtitle">{pendingCount} pendiente{pendingCount === 1 ? "" : "s"}. Ahora también pueden alimentar el progreso de tus objetivos.</p>

        <form className="taskComposer" onSubmit={addTask}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nueva tarea" maxLength={240} aria-label="Título de la tarea" />
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label="Fecha opcional" />
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)} aria-label="Objetivo opcional">
            <option value="">Sin objetivo</option>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.icon} {goal.name}</option>)}
          </select>
          <button type="submit" disabled={saving || !title.trim()}>{saving ? "Guardando…" : "Añadir"}</button>
        </form>

        {error && <p className="taskError">{error}</p>}

        <div className="taskList" aria-live="polite">
          {loading && <div className="taskEmpty">Cargando tareas…</div>}
          {!loading && tasks.length === 0 && <div className="taskEmpty">No hay tareas. El tablero está limpio.</div>}
          {tasks.map((task) => (
            <article key={task.id} className={`taskItem ${task.completed ? "done" : ""}`}>
              <button className="taskCheck" type="button" onClick={() => void patchTask(task, { completed: !task.completed })} aria-label={task.completed ? "Marcar como pendiente" : "Completar tarea"}>{task.completed ? "✓" : ""}</button>
              <div className="taskBody">
                <strong>{task.title}</strong>
                <span>{formatDue(task.due_at)}</span>
                <select value={task.goal_id ?? ""} onChange={(event) => void patchTask(task, { goalId: event.target.value ? Number(event.target.value) : null })} aria-label={`Objetivo de ${task.title}`}>
                  <option value="">Sin objetivo</option>
                  {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.icon} {goal.name}</option>)}
                </select>
              </div>
              <button className="taskDelete" type="button" onClick={() => void removeTask(task.id)} aria-label="Eliminar tarea">×</button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
