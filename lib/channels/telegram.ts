import { isValidTelegramWebhookSecret, splitTelegramText } from "./security";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_REQUEST_TIMEOUT_MS = 12_000;

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  date: number;
  edit_date?: number;
  text?: string;
  voice?: TelegramVoice;
  location?: TelegramLocation;
};

export type TelegramLocation = {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
};

export type TelegramVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type TelegramBot = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export class TelegramConfigurationError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Telegram no está configurado: ${missing.join(", ")}`);
    this.name = "TelegramConfigurationError";
  }
}

export class TelegramApiError extends Error {
  constructor(public readonly method: string, description?: string) {
    super(description ? `Telegram ha rechazado ${method}: ${description}` : `Telegram no ha completado ${method}`);
    this.name = "TelegramApiError";
  }
}

export function telegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

export function telegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
}

export function telegramPublicBaseUrl() {
  return (process.env.ZYRON_PUBLIC_URL || process.env.NEXT_PUBLIC_ZYRON_BASE_URL || "").trim().replace(/\/+$/, "");
}

export function telegramConfigurationStatus() {
  const missing: string[] = [];
  const invalid: string[] = [];
  const botToken = telegramBotToken();
  const webhookSecret = telegramWebhookSecret();
  const publicBaseUrl = telegramPublicBaseUrl();

  if (!botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!webhookSecret) missing.push("TELEGRAM_WEBHOOK_SECRET");
  else if (!isValidTelegramWebhookSecret(webhookSecret)) invalid.push("TELEGRAM_WEBHOOK_SECRET");
  if (!publicBaseUrl) missing.push("ZYRON_PUBLIC_URL");
  else {
    try {
      const url = new URL(publicBaseUrl);
      if (url.protocol !== "https:") invalid.push("ZYRON_PUBLIC_URL");
    } catch {
      invalid.push("ZYRON_PUBLIC_URL");
    }
  }

  return {
    ready: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    botToken: Boolean(botToken),
    webhookSecret: Boolean(webhookSecret),
    publicUrl: Boolean(publicBaseUrl),
  };
}

function requireBotToken() {
  const token = telegramBotToken();
  if (!token) throw new TelegramConfigurationError(["TELEGRAM_BOT_TOKEN"]);
  return token;
}

async function telegramApi<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const token = requireBotToken();
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TelegramApiError(method);
  }

  const body = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!response.ok || !body?.ok || body.result === undefined) {
    throw new TelegramApiError(method, body?.description);
  }
  return body.result;
}

export function getTelegramBot() {
  return telegramApi<TelegramBot>("getMe");
}

export function getTelegramWebhookInfo() {
  return telegramApi<TelegramWebhookInfo>("getWebhookInfo");
}

export function getTelegramFile(fileId: string) {
  return telegramApi<TelegramFile>("getFile", { file_id: fileId });
}

export async function downloadTelegramFile(filePath: string, maxBytes: number) {
  if (!filePath || filePath.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(filePath)) {
    throw new TelegramApiError("downloadFile", "Ruta de archivo no válida");
  }

  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API_BASE}/file/bot${requireBotToken()}/${filePath}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TelegramApiError("downloadFile");
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (!response.ok || (declaredLength && declaredLength > maxBytes)) {
    throw new TelegramApiError("downloadFile", declaredLength > maxBytes ? "Archivo demasiado grande" : undefined);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new TelegramApiError("downloadFile", "Archivo demasiado grande");
  return bytes;
}

export async function setTelegramWebhook(options?: { dropPendingUpdates?: boolean }) {
  const status = telegramConfigurationStatus();
  if (!status.ready) throw new TelegramConfigurationError([...status.missing, ...status.invalid]);
  const url = `${telegramPublicBaseUrl()}/api/channels/telegram/webhook`;
  const result = await telegramApi<boolean>("setWebhook", {
    url,
    secret_token: telegramWebhookSecret(),
    allowed_updates: ["message", "edited_message"],
    max_connections: 4,
    drop_pending_updates: Boolean(options?.dropPendingUpdates),
  });
  return { result, url };
}

export function deleteTelegramWebhook() {
  return telegramApi<boolean>("deleteWebhook", { drop_pending_updates: true });
}

export function sendTelegramChatAction(chatId: string, action: "typing" = "typing") {
  return telegramApi<boolean>("sendChatAction", { chat_id: chatId, action });
}

export async function sendTelegramMessage(input: {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}) {
  const chunks = splitTelegramText(input.text);
  const sent: unknown[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    sent.push(await telegramApi<unknown>("sendMessage", {
      chat_id: input.chatId,
      text: chunks[index],
      protect_content: true,
      link_preview_options: { is_disabled: true },
      ...(index === 0 && input.replyToMessageId
        ? { reply_parameters: { message_id: input.replyToMessageId, allow_sending_without_reply: true } }
        : {}),
    }));
  }
  return sent;
}
