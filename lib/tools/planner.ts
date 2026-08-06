import { listTasks, recordAction, type ZyronTask } from "../db";

export type DailyPlan = {
  generatedAt: string;
  totalPending: number;
  selected: Array<{
    id: number;
    title: string;
    due_at: string | null;
    priority: "urgent" | "scheduled" | "unscheduled";
  }>;
};

function priorityOf(task: ZyronTask, now: number): DailyPlan["selected"][number]["priority"] {
  if (!task.due_at) return "unscheduled";
  const due = new Date(task.due_at).getTime();
  if (Number.isFinite(due) && due <= now + 24 * 60 * 60 * 1000) return "urgent";
  return "scheduled";
}

export async function buildDailyPlan(limit = 6): Promise<DailyPlan> {
  const now = Date.now();
  const pending = (await listTasks()).filter((task) => !task.completed);
  const selected = pending
    .map((task) => ({ ...task, priority: priorityOf(task, now) }))
    .sort((a, b) => {
      const rank = { urgent: 0, scheduled: 1, unscheduled: 2 } as const;
      const rankDiff = rank[a.priority] - rank[b.priority];
      if (rankDiff !== 0) return rankDiff;
      if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .slice(0, Math.max(1, Math.min(limit, 12)))
    .map(({ id, title, due_at, priority }) => ({ id, title, due_at, priority }));

  const plan: DailyPlan = {
    generatedAt: new Date().toISOString(),
    totalPending: pending.length,
    selected,
  };

  await recordAction("planner", "daily_plan_created", `Preparó un plan con ${selected.length} de ${pending.length} tareas pendientes.`, {
    taskIds: selected.map((task) => task.id),
    totalPending: pending.length,
  });

  return plan;
}

export function formatDailyPlan(plan: DailyPlan): string {
  if (!plan.selected.length) return "No tienes tareas pendientes. Tu día está sorprendentemente despejado.";

  const lines = plan.selected.map((task, index) => {
    const marker = task.priority === "urgent" ? "Prioridad alta" : task.priority === "scheduled" ? "Con fecha" : "Sin fecha";
    const due = task.due_at ? ` · ${new Date(task.due_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}` : "";
    return `${index + 1}. ${task.title} (${marker}${due})`;
  });

  const remaining = plan.totalPending - plan.selected.length;
  const tail = remaining > 0 ? `\nHe dejado ${remaining} tarea${remaining === 1 ? "" : "s"} fuera para que el plan no se convierta en una mudanza.` : "";
  return `Te propongo este orden para avanzar hoy:\n${lines.join("\n")}${tail}`;
}
