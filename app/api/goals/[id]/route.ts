import { NextResponse } from "next/server";
import { listGoals, listTasks } from "../../../../lib/db";

export const runtime = "nodejs";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "Objetivo no válido." }, { status: 400 });

    const [goals, tasks] = await Promise.all([listGoals(), listTasks()]);
    const goal = goals.find((item) => item.id === id);
    if (!goal) return NextResponse.json({ error: "Objetivo no encontrado." }, { status: 404 });

    const goalTasks = tasks.filter((task) => task.goal_id === id);
    const pending = goalTasks.filter((task) => !task.completed);
    const completed = goalTasks.filter((task) => task.completed);

    return NextResponse.json(
      {
        goal,
        tasks: goalTasks,
        summary: {
          total: goalTasks.length,
          pending: pending.length,
          completed: completed.length,
          nextDue: pending
            .filter((task) => task.due_at)
            .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())[0]?.due_at ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_GOAL_DETAIL_ERROR", error);
    return NextResponse.json({ error: "No he podido cargar el objetivo." }, { status: 500 });
  }
}
