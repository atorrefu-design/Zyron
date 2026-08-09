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

export type ZyronDeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

export type ZyronActionRequest = {
  text?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  deviceLocation?: ZyronDeviceLocation | null;
};

/**
 * Single action-first entry point for ZYRON clients.
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

/**
 * Browser/native bridge contract. The native companion can intercept this
 * cancelable event and call preventDefault() once it has accepted the command.
 * A normal PWA has no privileged executor, so it must not pretend success.
 */
export function dispatchNativeAction(data: ZyronActionResponse): boolean {
  if (typeof window === "undefined" || data.mode !== "native_execute" || !data.action) return false;
  const event = new CustomEvent("zyron:native-action", {
    cancelable: true,
    detail: {
      action: data.action,
      capabilityId: data.capabilityId,
      input: data.input,
    },
  });
  return !window.dispatchEvent(event);
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
