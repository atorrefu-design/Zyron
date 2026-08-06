import { NextResponse } from "next/server";
import { listActions, listTasks } from "../../../lib/db";
import { getZyronTools } from "../../../lib/tools/registry";

export const runtime = "nodejs";

export async function GET() {
  const [tasks, actions] = await Promise.all([listTasks(), listActions(8)]);
  const tools = Object.values(getZyronTools());
  const pending = tasks.filter((task) => !task.completed);
  const completed = tasks.filter((task) => task.completed);

  return NextResponse.json(
    {
      summary: {
        pendingTasks: pending.length,
        completedTasks: completed.length,
        availableTools: tools.filter((tool) => tool.status === "available").length,
        plannedTools: tools.filter((tool) => tool.status === "planned").length,
      },
      nextTasks: pending.slice(0, 5),
      recentActions: actions,
      tools,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
