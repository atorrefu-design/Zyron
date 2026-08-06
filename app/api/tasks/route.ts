import { NextRequest, NextResponse } from "next/server";
import { createTask, deleteTask, listTasks, setTaskCompleted } from "../../../lib/db";

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
    const body = (await request.json()) as { title?: unknown; dueAt?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const dueAt = typeof body.dueAt === "string" && body.dueAt ? body.dueAt : null;

    if (!title || title.length > 240) {
      return NextResponse.json({ error: "La tarea debe tener entre 1 y 240 caracteres" }, { status: 400 });
    }

    const task = await createTask(title, dueAt);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("tasks_post_error", error);
    return NextResponse.json({ error: "No se pudo crear la tarea" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: unknown; completed?: unknown };
    const id = parseId(body.id);
    if (!id || typeof body.completed !== "boolean") {
      return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
    }

    const task = await setTaskCompleted(id, body.completed);
    if (!task) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    return NextResponse.json({ task });
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
