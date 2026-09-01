import { NextResponse } from "next/server";
import {
  createChannelPairing,
  disableChannelBinding,
  getChannelBinding,
} from "../../../../lib/channels/store";
import {
  deleteTelegramWebhook,
  getTelegramBot,
  getTelegramWebhookInfo,
  setTelegramWebhook,
  telegramConfigurationStatus,
} from "../../../../lib/channels/telegram";
import { recordAction } from "../../../../lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const CHANNEL = "telegram";

async function audit(action: string, summary: string, metadata: Record<string, unknown> = {}) {
  try {
    await recordAction("telegram", action, summary, metadata);
  } catch (error) {
    console.error("ZYRON_TELEGRAM_AUDIT_ERROR", error instanceof Error ? error.message : "unknown");
  }
}

export async function GET() {
  try {
    const configuration = telegramConfigurationStatus();
    const binding = await getChannelBinding(CHANNEL);
    if (!configuration.botToken) {
      return NextResponse.json({
        configuration,
        connected: Boolean(binding?.enabled),
        binding: binding?.enabled
          ? { displayName: binding.display_name, updatedAt: binding.updated_at }
          : null,
        bot: null,
        webhook: null,
      });
    }

    const [bot, webhook] = await Promise.all([
      getTelegramBot(),
      getTelegramWebhookInfo(),
    ]);
    return NextResponse.json({
      configuration,
      connected: Boolean(binding?.enabled),
      binding: binding?.enabled
        ? { displayName: binding.display_name, updatedAt: binding.updated_at }
        : null,
      bot: { id: bot.id, firstName: bot.first_name, username: bot.username || null },
      webhook: {
        active: Boolean(webhook.url),
        url: webhook.url || null,
        pendingUpdates: webhook.pending_update_count,
        lastErrorAt: webhook.last_error_date
          ? new Date(webhook.last_error_date * 1_000).toISOString()
          : null,
        lastError: webhook.last_error_message || null,
      },
    });
  } catch (error) {
    console.error("ZYRON_TELEGRAM_STATUS_ERROR", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se ha podido consultar el estado de Telegram." }, { status: 502 });
  }
}

export async function POST() {
  try {
    const configuration = telegramConfigurationStatus();
    if (!configuration.ready) {
      return NextResponse.json({
        error: "Faltan variables seguras para activar Telegram.",
        configuration,
      }, { status: 503 });
    }

    const [bot, webhook] = await Promise.all([
      getTelegramBot(),
      setTelegramWebhook({ dropPendingUpdates: true }),
    ]);
    const pairing = await createChannelPairing(CHANNEL);
    await audit("channel_setup", "Configuró el webhook de Telegram y generó un código de vinculación.", {
      botId: bot.id,
      botUsername: bot.username || null,
      webhookUrl: webhook.url,
      pairingExpiresAt: pairing.expiresAt,
    });
    return NextResponse.json({
      ok: true,
      bot: { firstName: bot.first_name, username: bot.username || null },
      webhook: { active: webhook.result, url: webhook.url },
      pairing: { code: pairing.code, expiresAt: pairing.expiresAt },
    }, { status: 201 });
  } catch (error) {
    console.error("ZYRON_TELEGRAM_SETUP_ERROR", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se ha podido activar Telegram." }, { status: 502 });
  }
}

export async function DELETE() {
  try {
    const configuration = telegramConfigurationStatus();
    const [webhookRemoved, bindingDisabled] = await Promise.all([
      configuration.botToken ? deleteTelegramWebhook() : Promise.resolve(false),
      disableChannelBinding(CHANNEL),
    ]);
    await audit("channel_disabled", "Desactivó el canal de Telegram.", {
      webhookRemoved,
      bindingDisabled,
    });
    return NextResponse.json({ ok: true, webhookRemoved, bindingDisabled });
  } catch (error) {
    console.error("ZYRON_TELEGRAM_DISABLE_ERROR", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se ha podido desactivar Telegram." }, { status: 502 });
  }
}
