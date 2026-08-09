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

type NativeBridgeWindow = Window & {
  webkit?: {
    messageHandlers?: {
      zyronNativeAction?: {
        postMessage: (payload: Record<string, unknown>) => void;
      };
    };
  };
};

export type NativeActionResultDetail = {
  action?: string;
  handled: boolean;
  succeeded: boolean;
  reply?: string;
  value?: string;
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
 * Sends privileged work to the native iPhone companion when the ZYRON web UI
 * is hosted inside WKWebView. A plain browser/PWA has no privileged executor.
 */
export function dispatchNativeAction(data: ZyronActionResponse): boolean {
  if (typeof window === "undefined" || data.mode !== "native_execute" || !data.action) return false;

  const nativeWindow = window as NativeBridgeWindow;
  const handler = nativeWindow.webkit?.messageHandlers?.zyronNativeAction;
  if (handler) {
    handler.postMessage({
      action: data.action,
      capabilityId: data.capabilityId,
      input: data.input,
      payload: {},
    });
    return true;
  }

  // Compatibility hook for native shells that choose to intercept DOM events.
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

export function waitForNativeActionResult(
  action: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<NativeActionResultDetail> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("El puente nativo no está disponible."));
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const timer = window.setTimeout(() => finish(new Error("La acción nativa ha agotado el tiempo de espera.")), timeoutMs);

    const onAbort = () => finish(new DOMException("Aborted", "AbortError"));
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<NativeActionResultDetail>).detail;
      if (!detail || (detail.action && detail.action !== action)) return;
      cleanup();
      resolve(detail);
    };

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("zyron:native-action-result", onResult);
      options?.signal?.removeEventListener("abort", onAbort);
    }

    function finish(error: Error) {
      cleanup();
      reject(error);
    }

    window.addEventListener("zyron:native-action-result", onResult);
    options?.signal?.addEventListener("abort", onAbort, { once: true });
  });
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
