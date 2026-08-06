"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Task = {
  id: number;
  title: string;
  due_at: string | null;
  completed: boolean;
  created_at: string;
};

function formatDue(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pendingCount = useMemo(() => tasks.filter((task) => !task.completed).length, [tasks]);

  const loadTasks = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { tasks: Task[] };
      setTasks(data.tasks);
    } catch {
      setError("No he podido cargar las tareas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

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
        }),
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { task: Task };
      setTasks((current) => [data.task, ...current]);
      setTitle("");
      setDueAt("");
    } catch {
      setError("No he podido guardar la tarea.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    const completed = !task.completed;
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed } : item));
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, completed }),
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
        <div>
          <div className="brand">ZYRON</div>
          <div className="status">● Tareas persistentes activas</div>
        </div>
        <a className="ghostButton navLink" href="/">Volver</a>
      </header>

      <section className="panel tasksPanel">
        <div className="eyebrow">Panel operativo</div>
        <h1>Tareas</h1>
        <p className="subtitle">{pendingCount} pendiente{pendingCount === 1 ? "" : "s"}. Se guardan en la base de datos privada de ZYRON.</p>

        <form className="taskComposer" onSubmit={addTask}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Nueva tarea"
            maxLength={240}
            aria-label="Título de la tarea"
          />
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            aria-label="Fecha opcional"
          />
          <button type="submit" disabled={saving || !title.trim()}>{saving ? "Guardando…" : "Añadir"}</button>
        </form>

        {error && <p className="taskError">{error}</p>}

        <div className="taskList" aria-live="polite">
          {loading && <div className="taskEmpty">Cargando tareas…</div>}
          {!loading && tasks.length === 0 && <div className="taskEmpty">No hay tareas. El tablero está limpio.</div>}
          {tasks.map((task) => (
            <article key={task.id} className={`taskItem ${task.completed ? "done" : ""}`}>
              <button className="taskCheck" type="button" onClick={() => void toggleTask(task)} aria-label={task.completed ? "Marcar como pendiente" : "Completar tarea"}>
                {task.completed ? "✓" : ""}
              </button>
              <div className="taskBody">
                <strong>{task.title}</strong>
                <span>{formatDue(task.due_at)}</span>
              </div>
              <button className="taskDelete" type="button" onClick={() => void removeTask(task.id)} aria-label="Eliminar tarea">×</button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
