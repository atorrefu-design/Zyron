import { NextRequest, NextResponse } from "next/server";
import { assignTaskToGoal, createTask, deleteTask, listTasks, recordAction, setTaskCompleted } from "../../../lib/db";
import { inferGoalForTask } from "../../../lib/tools/goal-router";

export const runtime = "nodejs";

function parseId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET() {
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("tasks_get_error", error);
    return NextResponse.json({ error: "No se pudieron cargar las tareas" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { title?: unknown; dueAt?: unknown; goalId?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const dueAt = typeof body.dueAt === "string" && body.dueAt ? body.dueAt : null;
    const explicitGoal = body.goalId !== null && body.goalId !== "" && body.goalId !== undefined;
    const parsedGoalId = explicitGoal ? parseId(body.goalId) : null;

    if (!title || title.length > 240) {
      return NextResponse.json({ error: "La tarea debe tener entre 1 y 240 caracteres" }, { status: 400 });
    }
    if (explicitGoal && !parsedGoalId) {
      return NextResponse.json({ error: "Objetivo no válido" }, { status: 400 });
    }

    const inferredGoal = explicitGoal ? null : await inferGoalForTask(title);
    const goalId = parsedGoalId ?? inferredGoal?.id ?? null;
    const task = await createTask(title, dueAt, goalId);

    await recordAction("tasks", "task_created", `Creó la tarea “${task.title}”.`, {
      taskId: task.id,
      title: task.title,
      goalId: task.goal_id,
      goalAssignment: explicitGoal ? "manual" : inferredGoal ? "automatic" : "none",
      goalSlug: inferredGoal?.slug ?? null,
    }).catch((error) => console.error("task_action_log_error", error));

    return NextResponse.json(
      {
        task,
        goal: inferredGoal ? { id: inferredGoal.id, name: inferredGoal.name, slug: inferredGoal.slug, icon: inferredGoal.icon } : null,
        goalAssignment: explicitGoal ? "manual" : inferredGoal ? "automatic" : "none",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("tasks_post_error", error);
    return NextResponse.json({ error: "No se pudo crear la tarea" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: unknown; completed?: unknown; goalId?: unknown };
    const id = parseId(body.id);
    if (!id) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

    if (typeof body.completed === "boolean") {
      const task = await setTaskCompleted(id, body.completed);
      if (!task) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
      return NextResponse.json({ task });
    }

    if (body.goalId === null || body.goalId === "" || parseId(body.goalId)) {
      const goalId = body.goalId === null || body.goalId === "" ? null : parseId(body.goalId);
      const task = await assignTaskToGoal(id, goalId);
      if (!task) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
      return NextResponse.json({ task });
    }

    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  } catch (error) {
    console.error("tasks_patch_error", error);
    return NextResponse.json({ error: "No se pudo actualizar la tarea" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = parseId(new URL(request.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Identificador no válido" }, { status: 400 });

    const deleted = await deleteTask(id);
    if (!deleted) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("tasks_delete_error", error);
    return NextResponse.json({ error: "No se pudo eliminar la tarea" }, { status: 500 });
  }
}
