export type ZyronActionResponse = {
  ok?: boolean;
  reply?: string;
  error?: string;
  mode?: "native_execute" | "confirmation_required" | "access_required";
  action?: string;
  capabilityId?: string;
  input?: string;
  transport?: "server" | "native";
  target?: string;
  message?: string;
};

export type ZyronActionRequest = {
  text?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
};

/**
 * Single action-first entry point for ZYRON clients.
 *
 * The caller should treat `native_execute` as an instruction to execute the
 * returned native action immediately through the iPhone companion. It must not
 * present the internal plan to the user as the normal response.
 */
export async function executeZyronRequest(
  request: ZyronActionRequest,
  options?: { signal?: AbortSignal },
): Promise<ZyronActionResponse> {
  const response = await fetch("/api/act", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
    signal: options?.signal,
  });

  const data = (await response.json().catch(() => ({}))) as ZyronActionResponse;
  if (!response.ok && !data.mode) {
    throw new Error(data.error || `Error ${response.status}`);
  }

  return data;
}

export function userFacingTextForBlockedAction(data: ZyronActionResponse): string | null {
  if (data.reply?.trim()) return data.reply.trim();
  if (data.mode === "access_required") {
    return data.message?.trim() || "Necesito un permiso del iPhone para continuar.";
  }
  if (data.mode === "confirmation_required") {
    return "Necesito tu confirmación antes de ejecutar esta acción.";
  }
  if (data.error?.trim()) return data.error.trim();
  return null;
}
