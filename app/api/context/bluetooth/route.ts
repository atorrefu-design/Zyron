import { NextResponse } from "next/server";
import { executeDeterministicCommand } from "../../../../lib/core/deterministic";
import { recordAction } from "../../../../lib/db";
import {
  bluetoothContextLabels,
  normalizeBluetoothContextEvent,
  saveBluetoothContext,
  type BluetoothContextAction,
} from "../../../../lib/device-context";

export const runtime = "nodejs";

const deterministicActions: Partial<Record<BluetoothContextAction, "briefing" | "daily_plan" | "diagnostics">> = {
  briefing: "briefing",
  daily_plan: "daily_plan",
  diagnostics: "diagnostics",
};

export async function POST(request: Request) {
  try {
    const event = normalizeBluetoothContextEvent(await request.json());
    if (!event) return NextResponse.json({ error: "invalid_bluetooth_context" }, { status: 400 });

    const current = await saveBluetoothContext(event);
    const label = bluetoothContextLabels[event.context];
    await recordAction("native", "bluetooth_context_connected", `Detectó una conexión Bluetooth en contexto ${label}.`, {
      context: event.context,
      action: event.action,
      deviceName: event.deviceName,
      expiresAt: current.expiresAt,
    });

    const command = deterministicActions[event.action];
    if (!command) {
      return NextResponse.json({
        ok: true,
        reply: `Conexión detectada. He activado el contexto ${label}${event.deviceName ? ` para ${event.deviceName}` : ""}.`,
        context: current,
        creditsUsed: false,
      });
    }

    const result = await executeDeterministicCommand({ type: command });
    return NextResponse.json({
      ok: true,
      reply: `Contexto ${label} activado.\n\n${result.reply}`,
      context: current,
      action: result.action,
      creditsUsed: false,
    });
  } catch (error) {
    console.error("ZYRON_BLUETOOTH_CONTEXT_ERROR", error);
    return NextResponse.json({ error: "bluetooth_context_failed" }, { status: 500 });
  }
}
