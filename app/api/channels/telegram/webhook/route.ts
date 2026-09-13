import { formatWeatherReply, getWeatherForecast, weatherRequestHorizon } from "../../../../../lib/weather";
import { NextResponse } from "next/server";
import { AIProviderUnavailableError } from "../../../../../lib/ai/router";
import { runZyronAgent } from "../../../../../lib/agent/runtime";
import {
  appendChannelMessage,
  claimChannelUpdate,
  clearChannelMessages,
  clearChannelLocation,
  completeChannelUpdate,
  failChannelUpdate,
  getChannelBinding,
  getCurrentChannelLocation,
  listRecentChannelMessages,
  redeemChannelPairing,
  saveChannelUpdateReply,
  saveChannelLocation,
} from "../../../../../lib/channels/store";
import {
  isValidTelegramWebhookSecret,
  parseTelegramCommand,
  secureSecretEquals,
} from "../../../../../lib/channels/security";
import {
  sendTelegramChatAction,
  sendTelegramMessage,
  setTelegramWebhook,
  telegramWebhookSecret,
  type TelegramMessage,
  type TelegramUpdate,
} from "../../../../../lib/channels/telegram";
import {
  telegramVoiceValidationMessage,
  transcribeTelegramVoice,
  validateTelegramVoice,
} from "../../../../../lib/channels/transcription";
import { recordAction } from "../../../../../lib/db";
import { telegramLocationObservation } from "../../../../../lib/channels/location.ts";
import {
  directMemoryQuery,
  looksLikeMemoryWriteRequest,
  resolveMemoryWriteRequest,
  renderMemoryPage,
  renderMemorySearch,
} from "../../../../../lib/channels/memory-access.ts";
import {
  getMemoryStats,
  listMemoryBlocksPage,
  searchMemoryBlocks,
  recordManualMemoryFact,
} from "../../../../../lib/memory.ts";
import { renderTelegramCapabilities } from "../../../../../lib/channels/parity.ts";
import { directCurrentInfoQuery } from "../../../../../lib/channels/current-info.ts";
import { searchCurrentInformation } from "../../../../../lib/current-search.ts";
import { runDeterministicCommand } from "../../../../../lib/core/deterministic.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHANNEL = "telegram";
const MAX_UPDATE_BYTES = 64_000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function displayName(message: TelegramMessage) {
  return [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim() || null;
}

async function audit(action: string, summary: string, metadata: Record<string, unknown> = {}) {
  try {
    await recordAction("telegram", action, summary, metadata);
  } catch (error) {
    console.error("ZYRON_TELEGRAM_AUDIT_ERROR", error instanceof Error ? error.message : "unknown");
  }
}

async function saveTelegramMemory(input: {
  chatId: string;
  updateId: string;
  messageId: number;
  userText: string;
  fact: string;
  source: "explicit" | "confirmed_previous";
}) {
  const block = await recordManualMemoryFact(input.fact, {
    source: "zyron-telegram-direct",
    idempotencyKey: `telegram:${input.chatId}:${input.updateId}:memory`,
    channel: CHANNEL,
    confirmation: input.source,
  });
  const reply = `Hecho, señor. He guardado en la memoria de ZYRON: «${block.content}».`;
  await appendChannelMessage({
    channel: CHANNEL,
    chatId: input.chatId,
    role: "user",
    content: input.userText,
    externalMessageId: `telegram:${input.chatId}:${input.messageId}:user`,
  });
  await appendChannelMessage({
    channel: CHANNEL,
    chatId: input.chatId,
    role: "assistant",
    content: reply,
    externalMessageId: `telegram:update:${input.updateId}:assistant`,
  });
  await deliverReply({
    chatId: input.chatId,
    updateId: input.updateId,
    reply,
    replyToMessageId: input.messageId,
  });
  await audit("channel_memory_saved", "Guardó una memoria explícitamente confirmada desde Telegram.", {
    memoryBlockId: block.id,
    confirmation: input.source,
  });
}

async function deliverReply(input: {
  chatId: string;
  updateId: string;
  reply: string;
  replyToMessageId?: number;
}) {
  const safeReply = input.reply.trim().slice(0, 20_000) || "No he podido construir una respuesta útil.";
  await saveChannelUpdateReply(CHANNEL, input.updateId, safeReply);
  await sendTelegramMessage({
    chatId: input.chatId,
    text: safeReply,
    replyToMessageId: input.replyToMessageId,
  });
  await completeChannelUpdate(CHANNEL, input.updateId);
}

export async function POST(request: Request) {
  const expectedSecret = telegramWebhookSecret();
  if (!isValidTelegramWebhookSecret(expectedSecret)) return json({ error: "Canal no configurado" }, 503);
  if (!secureSecretEquals(expectedSecret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    return json({ error: "No autorizado" }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_UPDATE_BYTES) return json({ error: "Actualización demasiado grande" }, 413);

  let rawUpdate: string;
  try {
    rawUpdate = await request.text();
  } catch {
    return json({ error: "No se ha podido leer la actualización" }, 400);
  }
  if (Buffer.byteLength(rawUpdate, "utf8") > MAX_UPDATE_BYTES) {
    return json({ error: "Actualización demasiado grande" }, 413);
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(rawUpdate) as TelegramUpdate;
  } catch {
    return json({ error: "JSON no válido" }, 400);
  }

  const message = update.message || update.edited_message;
  const isEditedMessage = Boolean(!update.message && update.edited_message);
  if (!message || message.chat.type !== "private" || message.from?.is_bot) {
    return json({ ok: true, ignored: true });
  }
  if (!Number.isSafeInteger(update.update_id) || !Number.isSafeInteger(message.chat.id) || !Number.isSafeInteger(message.from?.id)) {
    return json({ error: "Identificadores no válidos" }, 400);
  }

  const updateId = String(update.update_id);
  const chatId = String(message.chat.id);
  const userId = String(message.from?.id);
  let claimed = false;

  try {
    const claim = await claimChannelUpdate({ channel: CHANNEL, updateId, chatId });
    if (claim.mode === "duplicate") return json({ ok: true, duplicate: true });
    if (claim.mode === "busy") {
      return NextResponse.json({ error: "Actualización en proceso" }, {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      });
    }
    claimed = true;
    if (claim.mode === "resend") {
      await sendTelegramMessage({ chatId, text: claim.reply, replyToMessageId: message.message_id });
      await completeChannelUpdate(CHANNEL, updateId);
      return json({ ok: true, resent: true });
    }

    const text = message.text?.trim() || "";
    const command = text ? parseTelegramCommand(text) : null;
    if (command?.name === "pair") {
      const binding = await redeemChannelPairing({
        channel: CHANNEL,
        code: command.argument,
        externalUserId: userId,
        externalChatId: chatId,
        displayName: displayName(message),
      });
      const reply = binding
        ? "Telegram ya está vinculado con tu núcleo privado de ZYRON. Puedes escribirme con normalidad."
        : "El código no es válido o ha caducado. Genera uno nuevo en ZYRON → Canales.";
      await deliverReply({ chatId, updateId, reply, replyToMessageId: message.message_id });
      if (binding) {
        await audit("channel_paired", "Vinculó el propietario con Telegram.", {
          channel: CHANNEL,
          displayName: binding.display_name,
        });
      }
      return json({ ok: true, paired: Boolean(binding) });
    }

    const binding = await getChannelBinding(CHANNEL);
    const authorized = Boolean(
      binding?.enabled
      && binding.external_user_id === userId
      && binding.external_chat_id === chatId,
    );
    if (!authorized) {
      if (command?.name === "start" || command?.name === "help") {
        await deliverReply({
          chatId,
          updateId,
          reply: "Este bot pertenece a un núcleo privado de ZYRON. La vinculación se inicia desde la pantalla Canales de la web.",
          replyToMessageId: message.message_id,
        });
      } else {
        await completeChannelUpdate(CHANNEL, updateId);
      }
      return json({ ok: true, authorized: false });
    }

    if (command?.name === "start" || command?.name === "help") {
      await deliverReply({
        chatId,
        updateId,
        reply: "ZYRON está conectado. Telegram es una interfaz del mismo núcleo, no otro asistente. Órdenes directas: /tareas, /tarea texto, /completar texto, /plan, /briefing, /actividad y /diagnostico. Memoria directa: /guardar_memoria hecho, /memoria tema, /memoria_toda 1 y /memoria_estado. Estado y privacidad: /capacidades, /status, /location, /forget_location y /reset.",
        replyToMessageId: message.message_id,
      });
      return json({ ok: true });
    }
    if (command?.name === "capacidades" || command?.name === "capabilities") {
      await deliverReply({
        chatId,
        updateId,
        reply: renderTelegramCapabilities(),
        replyToMessageId: message.message_id,
      });
      return json({ ok: true, capabilityStatus: true });
    }
    if (command?.name === "status") {
      const currentLocation = await getCurrentChannelLocation(CHANNEL, chatId);
      await deliverReply({
        chatId,
        updateId,
        reply: currentLocation
          ? `Canal Telegram conectado. Ubicación ${currentLocation.live ? "en tiempo real" : "reciente"} disponible hasta ${new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(currentLocation.expiresAt))}.`
          : "Canal Telegram conectado. No hay una ubicación actual válida compartida.",
        replyToMessageId: message.message_id,
      });
      return json({ ok: true });
    }
    if (command?.name === "location") {
      const currentLocation = await getCurrentChannelLocation(CHANNEL, chatId);
      await deliverReply({
        chatId,
        updateId,
        reply: currentLocation
          ? `Tengo una ubicación ${currentLocation.live ? "en tiempo real" : "reciente"} válida. Última actualización: ${new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "medium" }).format(new Date(currentLocation.observedAt))}.`
          : "No tengo una ubicación vigente. En Telegram pulsa el clip → Ubicación → Compartir ubicación en tiempo real.",
        replyToMessageId: message.message_id,
      });
      return json({ ok: true });
    }
    if (command?.name === "forget_location") {
      const removed = await clearChannelLocation(CHANNEL, chatId);
      await deliverReply({
        chatId,
        updateId,
        reply: removed ? "He eliminado la ubicación guardada por ZYRON." : "ZYRON no tenía ninguna ubicación guardada.",
        replyToMessageId: message.message_id,
      });
      await audit("channel_location_cleared", "Eliminó la ubicación temporal del canal.");
      return json({ ok: true });
    }
    if (command?.name === "memoria_estado") {
      const stats = await getMemoryStats();
      await deliverReply({
        chatId,
        updateId,
        reply: `Memoria privada conectada: ${stats.documents} documento${stats.documents === 1 ? "" : "s"}, ${stats.blocks} bloques activos y ${stats.revisions} revisiones. Consulta directa, sin IA.`,
        replyToMessageId: message.message_id,
      });
      return json({ ok: true, directMemory: true });
    }
    if (command?.name === "guardar_memoria") {
      const fact = command.argument.trim().slice(0, 2_000);
      if (!fact) {
        await deliverReply({
          chatId,
          updateId,
          reply: "Escribe /guardar_memoria seguido del hecho que quieres conservar.",
          replyToMessageId: message.message_id,
        });
        return json({ ok: true, directMemory: true });
      }
      await saveTelegramMemory({
        chatId,
        updateId,
        messageId: message.message_id,
        userText: text,
        fact,
        source: "explicit",
      });
      return json({ ok: true, directMemoryWrite: true });
    }
    if (command?.name === "memoria_toda") {
      const requestedPage = Number(command.argument || 1);
      const page = await listMemoryBlocksPage(Number.isFinite(requestedPage) ? requestedPage : 1, 5);
      await deliverReply({
        chatId,
        updateId,
        reply: renderMemoryPage(page),
        replyToMessageId: message.message_id,
      });
      await audit("channel_memory_page_read", "Consultó una página de la memoria privada sin IA.", {
        page: page.page,
        blocks: page.blocks.length,
      });
      return json({ ok: true, directMemory: true });
    }
    if (command?.name === "memoria") {
      const query = command.argument.trim();
      if (!query) {
        await deliverReply({
          chatId,
          updateId,
          reply: "Escribe /memoria seguido del tema que quieres consultar. Ejemplo: /memoria equipo de baloncesto. Para recorrerla entera: /memoria_toda 1.",
          replyToMessageId: message.message_id,
        });
        return json({ ok: true, directMemory: true });
      }
      const matches = await searchMemoryBlocks(query, { limit: 5, includeAlways: false });
      await deliverReply({
        chatId,
        updateId,
        reply: renderMemorySearch(query, matches),
        replyToMessageId: message.message_id,
      });
      await audit("channel_memory_searched", "Buscó directamente en la memoria privada sin IA.", { matches: matches.length });
      return json({ ok: true, directMemory: true });
    }
    if (command?.name === "reset") {
      const removed = await clearChannelMessages(CHANNEL, chatId);
      await deliverReply({
        chatId,
        updateId,
        reply: `He borrado ${removed} mensajes del historial temporal de Telegram. La memoria y el historial compartido se conservan; puede gestionarlos en https://zyron-five.vercel.app/history.`,
        replyToMessageId: message.message_id,
      });
      await audit("channel_history_cleared", "Borró el historial temporal de Telegram.", { removed });
      return json({ ok: true });
    }
    if (message.location) {
      const observation = telegramLocationObservation({
        message_id: message.message_id,
        date: message.date,
        edit_date: message.edit_date,
        location: message.location,
      });
      if (!observation) {
        await deliverReply({
          chatId,
          updateId,
          reply: "La ubicación recibida no es válida. Compártela de nuevo desde Telegram.",
          replyToMessageId: message.message_id,
        });
        return json({ ok: true, locationRejected: true });
      }
      if (isEditedMessage && !observation.live) {
        await clearChannelLocation(CHANNEL, chatId);
        await completeChannelUpdate(CHANNEL, updateId);
        return json({ ok: true, liveLocationStopped: true });
      }
      await saveChannelLocation({ channel: CHANNEL, chatId, location: observation });
      if (observation.live && !isEditedMessage) {
        await setTelegramWebhook();
      }
      if (isEditedMessage) {
        await completeChannelUpdate(CHANNEL, updateId);
        return json({ ok: true, liveLocationUpdated: true });
      }
      const reply = observation.live
        ? "Ubicación en tiempo real activada. ZYRON usará automáticamente la posición más reciente mientras Telegram siga compartiéndola. No guardaré un historial de tus movimientos."
        : "Ubicación recibida. La usaré durante 30 minutos; para acceso continuo, comparte una ubicación en tiempo real.";
      await deliverReply({ chatId, updateId, reply, replyToMessageId: message.message_id });
      await audit("channel_location_shared", observation.live
        ? "Activó la ubicación en tiempo real del canal."
        : "Compartió una ubicación temporal con el canal.", { live: observation.live });
      return json({ ok: true, liveLocation: observation.live });
    }
    if (!text && !message.voice) {
      await deliverReply({
        chatId,
        updateId,
        reply: "Este canal admite mensajes de texto, notas de voz y ubicación compartida. Otros archivos todavía no se procesan.",
        replyToMessageId: message.message_id,
      });
      return json({ ok: true });
    }

    let cleanText = text.slice(0, 4_096);
    let inputMode: "text" | "voice" = "text";
    if (!cleanText && message.voice) {
      const validation = validateTelegramVoice(message.voice);
      if (!validation.ok) {
        await deliverReply({
          chatId,
          updateId,
          reply: telegramVoiceValidationMessage(validation),
          replyToMessageId: message.message_id,
        });
        return json({ ok: true, voiceRejected: validation.reason });
      }
      void sendTelegramChatAction(chatId).catch(() => undefined);
      try {
        cleanText = await transcribeTelegramVoice(message.voice);
        inputMode = "voice";
      } catch (error) {
        console.error("ZYRON_TELEGRAM_TRANSCRIPTION_ERROR", error instanceof Error ? error.message : "unknown");
        await deliverReply({
          chatId,
          updateId,
          reply: "No he podido transcribir esta nota de voz. Puedes repetirla o escribir el mensaje.",
          replyToMessageId: message.message_id,
        });
        return json({ ok: true, transcriptionFailed: true });
      }
    }

    const noAI = /^\/sin_ia(?:@[a-z0-9_]+)?(?:\s|$)/i.test(cleanText);
    if (noAI) cleanText = cleanText.replace(/^\/sin_ia(?:@[a-z0-9_]+)?\s*/i, "");
    const horizon = weatherRequestHorizon(cleanText);
    if (horizon) {
      const location = await getCurrentChannelLocation(CHANNEL, chatId);
      let reply: string;
      try {
        const forecast = await getWeatherForecast(location?.latitude ?? 41.3874, location?.longitude ?? 2.1686);
        reply = formatWeatherReply(forecast, horizon, location ? "su ubicación compartida" : "Barcelona (ubicación de referencia)");
      } catch {
        reply = "Señor, el servicio meteorológico no ha respondido. No tengo una previsión verificada en este momento.";
      }
      await deliverReply({ chatId, updateId, reply, replyToMessageId: message.message_id });
      return json({ ok: true, directWeather: true, creditsUsed: inputMode === "text" ? false : "transcription_only" });
    }
    if (looksLikeMemoryWriteRequest(cleanText)) {
      const history = await listRecentChannelMessages(CHANNEL, chatId, 24);
      const memoryWrite = resolveMemoryWriteRequest(cleanText, history);
      if (memoryWrite) {
        await saveTelegramMemory({
          chatId,
          updateId,
          messageId: message.message_id,
          userText: cleanText,
          fact: memoryWrite.fact,
          source: memoryWrite.source,
        });
        return json({
          ok: true,
          directMemoryWrite: true,
          inputMode,
          creditsUsed: inputMode === "text" ? false : "transcription_only",
        });
      }
    }
    const memoryQuery = directMemoryQuery(cleanText);
    if (memoryQuery) {
      const matches = await searchMemoryBlocks(memoryQuery, { limit: 5, includeAlways: false });
      await deliverReply({
        chatId,
        updateId,
        reply: renderMemorySearch(memoryQuery, matches),
        replyToMessageId: message.message_id,
      });
      await audit("channel_memory_searched", "Buscó directamente en la memoria privada sin IA.", { matches: matches.length });
      return json({ ok: true, directMemory: true, inputMode });
    }
    if (inputMode === "text" && !noAI) {
      const currentInfoQuery = directCurrentInfoQuery(cleanText);
      if (currentInfoQuery) {
        await appendChannelMessage({
          channel: CHANNEL,
          chatId,
          role: "user",
          content: cleanText,
          externalMessageId: `telegram:${chatId}:${message.message_id}:user`,
        });
        void sendTelegramChatAction(chatId).catch(() => undefined);
        let directReply: string;
        try {
          directReply = (await searchCurrentInformation(currentInfoQuery)).reply;
        } catch (error) {
          console.error("ZYRON_TELEGRAM_CURRENT_SEARCH_ERROR", error instanceof Error ? error.message : "unknown");
          directReply = "No he podido completar la consulta web ahora mismo. El mensaje sí se ha recibido y no he ejecutado ninguna acción ni reintento automático.";
        }
        await appendChannelMessage({
          channel: CHANNEL,
          chatId,
          role: "assistant",
          content: directReply,
          externalMessageId: `telegram:update:${updateId}:assistant`,
        });
        await deliverReply({ chatId, updateId, reply: directReply, replyToMessageId: message.message_id });
        await audit("channel_current_information_searched", "Procesó una consulta web directa desde Telegram.", {
          ok: !directReply.startsWith("No he podido"),
          aiCalls: 1,
        });
        return json({ ok: true, directCurrentInfo: true });
      }
    }
    const directCommand = await runDeterministicCommand(cleanText);
    if (directCommand) {
      const directReply = inputMode === "voice"
        ? directCommand.reply.replaceAll("sin modelo de IA", "sin modelo de razonamiento; la nota de voz sí ha requerido transcripción")
        : directCommand.reply;
      await appendChannelMessage({
        channel: CHANNEL,
        chatId,
        role: "user",
        content: inputMode === "voice" ? `[Nota de voz transcrita] ${cleanText}` : cleanText,
        externalMessageId: `telegram:${chatId}:${message.message_id}:user`,
      });
      await appendChannelMessage({
        channel: CHANNEL,
        chatId,
        role: "assistant",
        content: directReply,
        externalMessageId: `telegram:update:${updateId}:assistant`,
      });
      await deliverReply({ chatId, updateId, reply: directReply, replyToMessageId: message.message_id });
      await audit("channel_direct_command", "Ejecutó una orden determinista desde Telegram.", {
        action: directCommand.action,
        tool: directCommand.tool,
        creditsUsed: inputMode === "text" ? false : "transcription_only",
        inputMode,
      });
      return json({ ok: true, directCommand: directCommand.action, creditsUsed: inputMode === "text" ? false : "transcription_only" });
    }
    await appendChannelMessage({
      channel: CHANNEL,
      chatId,
      role: "user",
      content: inputMode === "voice" ? `[Nota de voz transcrita] ${cleanText}` : cleanText,
      externalMessageId: `telegram:${chatId}:${message.message_id}:user`,
    });
    if (noAI) {
      await deliverReply({ chatId, updateId, reply: "Señor, no he utilizado IA generativa. Pruebe /sin_ia tareas pendientes, /sin_ia qué tiempo hará mañana o /sin_ia guarda en tu memoria que… Para conversación abierta, envíe el mensaje sin /sin_ia.", replyToMessageId: message.message_id });
      return json({ ok: true, aiDisabled: true, creditsUsed: inputMode === "text" ? false : "transcription_only" });
    }
    const history = await listRecentChannelMessages(CHANNEL, chatId);
    void sendTelegramChatAction(chatId).catch(() => undefined);

    let reply: string;
    let provider: string | null = null;
    let toolsUsed: string[] = [];
    try {
      const currentLocation = await getCurrentChannelLocation(CHANNEL, chatId);
      const result = await runZyronAgent({ messages: history, currentLocation, channel: "telegram" });
      reply = result.reply;
      provider = result.provider;
      toolsUsed = result.trace.map((item) => item.tool);
    } catch (error) {
      if (error instanceof AIProviderUnavailableError) {
        reply = error.message;
      } else {
        console.error("ZYRON_TELEGRAM_AGENT_ERROR", error instanceof Error ? error.message : "unknown");
        reply = "He recibido tu mensaje, pero el núcleo no ha podido terminar la respuesta. No se ha ejecutado ninguna acción ni reintento automático.";
      }
    }

    await appendChannelMessage({
      channel: CHANNEL,
      chatId,
      role: "assistant",
      content: reply,
      externalMessageId: `telegram:update:${updateId}:assistant`,
    });
    await deliverReply({ chatId, updateId, reply, replyToMessageId: message.message_id });
    await audit("channel_message_processed", "Procesó un mensaje autorizado de Telegram.", {
      updateId,
      provider,
      toolsUsed,
      inputMode,
      voiceDurationSeconds: inputMode === "voice" ? message.voice?.duration : undefined,
    });
    return json({ ok: true });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "unknown";
    if (claimed) {
      await failChannelUpdate(CHANNEL, updateId, messageText).catch(() => undefined);
    }
    console.error("ZYRON_TELEGRAM_WEBHOOK_ERROR", messageText);
    return json({ error: "No se ha podido procesar la actualización" }, 500);
  }
}
