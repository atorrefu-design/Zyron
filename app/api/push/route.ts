import { NextResponse } from "next/server";
import {
  countPushSubscriptions,
  getOrCreateVapidKeys,
  savePushSubscription,
  sendPushNotification,
  type BrowserPushSubscription,
} from "../../../lib/push";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [vapid, subscriptions] = await Promise.all([
      getOrCreateVapidKeys(),
      countPushSubscriptions(),
    ]);
    return NextResponse.json(
      {
        configured: true,
        publicKey: vapid.publicKey,
        subscriptions,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_PUSH_STATUS_ERROR", error);
    return NextResponse.json(
      { configured: false, error: error instanceof Error ? error.message : "push_status_error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "subscribe" | "test";
      subscription?: BrowserPushSubscription;
    };

    if (body.action === "subscribe") {
      if (!body.subscription) {
        return NextResponse.json({ error: "Falta la suscripción push." }, { status: 400 });
      }
      await savePushSubscription(body.subscription, request.headers.get("user-agent"));
      return NextResponse.json({ ok: true, subscribed: true });
    }

    if (body.action === "test") {
      const result = await sendPushNotification({
        title: "ZYRON está conectado",
        body: "Las notificaciones proactivas ya pueden llegar a este dispositivo incluso con ZYRON cerrado.",
        url: "/",
        tag: `zyron-test-${Date.now()}`,
      });
      if (result.sent === 0) {
        return NextResponse.json({ error: "No hay ningún dispositivo push activo.", result }, { status: 409 });
      }
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ error: "Acción push no válida." }, { status: 400 });
  } catch (error) {
    console.error("ZYRON_PUSH_API_ERROR", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "push_api_error" },
      { status: 500 },
    );
  }
}
