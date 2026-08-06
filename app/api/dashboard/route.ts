import { NextResponse } from "next/server";
import { listActions, listGoals, listTasks } from "../../../lib/db";
import { getZyronHealth } from "../../../lib/health";
import { getZyronTools } from "../../../lib/tools/registry";
import { listCalendarEvents } from "../../../lib/google/calendar";

export const runtime = "nodejs";

export async function GET() {
  const calendarPromise = listCalendarEvents({ maxResults: 6 }).then(
    (events) => ({ connected: true, events, error: null as string | null }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "calendar_unknown_error";
      const missingScope = message.includes("403") || message.includes("insufficientPermissions");
      return {
        connected: true,
        events: [],
        error: missingScope
          ? "Falta autorizar el permiso de lectura de Google Calendar."
          : "No se han podido leer los próximos eventos.",
      };
    },
  );

  const [tasks, actions, health, goals, calendar] = await Promise.all([
    listTasks(),
    listActions(8),
    getZyronHealth(),
    listGoals(),
    calendarPromise,
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
      calendar,
      tools,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
