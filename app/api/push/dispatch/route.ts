import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { buildProactiveAlerts } from "../../../../lib/proactive";
import {
  claimPushDispatchWindow,
  markAlertsSent,
  sendPushNotification,
  wasAlertSent,
} from "../../../../lib/push";

export const runtime = "nodejs";

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`));

async function schedulerAuthorized(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET;
  if (secret && authorization === `Bearer ${secret}`) return true;

  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, GITHUB_JWKS, {
      issuer: GITHUB_ISSUER,
      audience: "zyron-push",
    });
    return payload.repository === "atorrefu-design/Zyron"
      && payload.ref === "refs/heads/main"
      && (payload.event_name === "schedule" || payload.event_name === "workflow_dispatch");
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!(await schedulerAuthorized(request))) {
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
