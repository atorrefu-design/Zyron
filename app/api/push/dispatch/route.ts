import { NextResponse } from "next/server";
import { buildProactiveAlerts } from "../../../../lib/proactive";
import {
  claimPushDispatchWindow,
  markAlertsSent,
  sendPushNotification,
  wasAlertSent,
} from "../../../../lib/push";

export const runtime = "nodejs";

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  return request.headers.get("x-vercel-cron-schedule") === "0 * * * *";
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const claimed = await claimPushDispatchWindow();
    if (!claimed) return NextResponse.json({ ok: true, skipped: "dispatch_window" });

    const result = await buildProactiveAlerts();
    const high = result.alerts.filter((alert) => alert.severity === "alta");
    const unsent = [];
    for (const alert of high) {
      if (!(await wasAlertSent(alert.id))) unsent.push(alert);
      if (unsent.length >= 3) break;
    }

    if (!unsent.length) {
      return NextResponse.json({ ok: true, alerts: 0, pushed: 0 });
    }

    const body = unsent
      .map((alert) => `• ${alert.title}: ${alert.detail}`)
      .join("\n")
      .slice(0, 900);
    const push = await sendPushNotification({
      title: unsent.length === 1 ? "ZYRON te avisa" : `ZYRON · ${unsent.length} asuntos importantes`,
      body,
      url: "/",
      tag: `zyron-proactive-${unsent.map((alert) => alert.id).join("-").slice(0, 120)}`,
    });

    if (push.sent > 0) await markAlertsSent(unsent.map((alert) => alert.id));

    return NextResponse.json({
      ok: true,
      alerts: unsent.length,
      pushed: push.sent,
      failed: push.failed,
      disabled: push.disabled,
    });
  } catch (error) {
    console.error("ZYRON_PUSH_DISPATCH_ERROR", error);
    return NextResponse.json({ error: "push_dispatch_failed" }, { status: 500 });
  }
}
