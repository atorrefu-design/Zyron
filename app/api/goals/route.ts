import { NextResponse } from "next/server";
import { createGoal, listGoals, recordAction } from "../../../lib/db";

export const runtime = "nodejs";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function GET() {
  try {
    const goals = await listGoals();
    return NextResponse.json({ goals, count: goals.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_GOALS_GET_ERROR", error);
    return NextResponse.json({ error: "No he podido cargar los objetivos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; icon?: string; description?: string };
    const name = body.name?.trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: "El nombre del objetivo es obligatorio." }, { status: 400 });

    const goal = await createGoal(name, slugify(name), body.icon?.trim().slice(0, 8) || "🎯", body.description?.trim().slice(0, 500));
    await recordAction("goals", "goal_created", `Creó el objetivo “${goal.name}”.`, { goalId: goal.id, slug: goal.slug });
    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error("ZYRON_GOALS_POST_ERROR", error);
    return NextResponse.json({ error: "No he podido crear el objetivo. Puede que ya exista uno con ese nombre." }, { status: 500 });
  }
}
