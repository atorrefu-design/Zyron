import { NextResponse } from "next/server";
import { listActions, listGoals, listTasks } from "../../../lib/db";
import { getZyronHealth } from "../../../lib/health";
import { getZyronTools } from "../../../lib/tools/registry";

export const runtime = "nodejs";

export async function GET() {
  const [tasks, actions, health, goals] = await Promise.all([
    listTasks(),
    listActions(8),
    getZyronHealth(),
    listGoals(),
  ]);
  const tools = Object.values(getZyronTools());
  const pending = tasks.filter((task) => !task.completed);
  const completed = tasks.filter((task) => task.completed);
  const activeGoals = goals.filter((goal) => goal.active);

  return NextResponse.json(
    {
      summary: {
        pendingTasks: pending.length,
        completedTasks: completed.length,
        availableTools: tools.filter((tool) => tool.status === "available").length,
        plannedTools: tools.filter((tool) => tool.status === "planned").length,
        activeGoals: activeGoals.length,
      },
      health,
      goals: activeGoals.slice(0, 6),
      nextTasks: pending.slice(0, 5),
      recentActions: actions,
      tools,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
