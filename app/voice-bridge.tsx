"use client";

import { useEffect, useState } from "react";

type VoiceState = "idle" | "request" | "generated" | "decoded" | "playing" | "error";

export default function VoiceBridge() {
  const [state, setState] = useState<VoiceState>("idle");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let active = true;
    let ttsWindowUntil = 0;
    let hideTimer: number | null = null;

    const update = (next: VoiceState, text: string, keep = false) => {
      if (!active) return;
      setState(next);
      setDetail(text);
      if (hideTimer) window.clearTimeout(hideTimer);
      if (!keep && next !== "error") {
        hideTimer = window.setTimeout(() => {
          if (!active) return;
          setState("idle");
          setDetail("");
        }, 12_000);
      }
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const isVoice = url.includes("/api/voice/speech");
      if (!isVoice) return originalFetch(input, init);

      update("request", "Voz · generando audio…", true);
      try {
        const response = await originalFetch(input, init);
        if (!response.ok) {
          let reason = "";
          try {
            const payload = await response.clone().json() as { detail?: string; error?: string };
            reason = payload.detail || payload.error || "";
          } catch {
            reason = await response.clone().text().catch(() => "");
          }
          update("error", `Voz · TTS ${response.status}${reason ? ` · ${reason.slice(0, 120)}` : ""}`, true);
          return response;
        }

        const clone = response.clone();
        const bytes = await clone.arrayBuffer().catch(() => new ArrayBuffer(0));
        ttsWindowUntil = Date.now() + 15_000;
        const kb = bytes.byteLength ? Math.max(1, Math.round(bytes.byteLength / 1024)) : 0;
        update("generated", `Voz · audio generado${kb ? ` · ${kb} KB` : ""}`, true);
        return response;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "fallo de red";
        update("error", `Voz · error de red · ${reason.slice(0, 120)}`, true);
        throw error;
      }
    }) as typeof window.fetch;

    const AudioContextCtor = window.AudioContext;
    const contextPrototype = AudioContextCtor?.prototype;
    const sourcePrototype = typeof AudioBufferSourceNode !== "undefined" ? AudioBufferSourceNode.prototype : null;
    const originalDecode = contextPrototype?.decodeAudioData;
    const originalStart = sourcePrototype?.start;

    if (contextPrototype && originalDecode) {
      try {
        contextPrototype.decodeAudioData = (function (this: AudioContext, audioData: ArrayBuffer, successCallback?: DecodeSuccessCallback | null, errorCallback?: DecodeErrorCallback | null) {
          const promise = originalDecode.call(this, audioData);
          void promise.then((buffer) => {
            if (Date.now() < ttsWindowUntil) update("decoded", `Voz · audio preparado · ${buffer.duration.toFixed(1)} s`, true);
            successCallback?.(buffer);
          }).catch((error) => {
            if (Date.now() < ttsWindowUntil) update("error", `Voz · no se puede decodificar el audio · ${error instanceof Error ? error.message : "error"}`, true);
            errorCallback?.(error as DOMException);
          });
          return promise;
        }) as typeof contextPrototype.decodeAudioData;
      } catch {
        // Diagnostics are optional and must never break voice playback.
      }
    }

    if (sourcePrototype && originalStart) {
      try {
        sourcePrototype.start = (function (this: AudioBufferSourceNode, when?: number, offset?: number, duration?: number) {
          if (Date.now() < ttsWindowUntil) update("playing", "Voz · reproduciendo en el iPhone", false);
          return originalStart.call(this, when, offset, duration);
        }) as typeof sourcePrototype.start;
      } catch {
        // Diagnostics are optional and must never break voice playback.
      }
    }

    return () => {
      active = false;
      if (hideTimer) window.clearTimeout(hideTimer);
      window.fetch = originalFetch;
      try {
        if (contextPrototype && originalDecode) contextPrototype.decodeAudioData = originalDecode;
        if (sourcePrototype && originalStart) sourcePrototype.start = originalStart;
      } catch {
        // Browser prototypes can be read-only.
      }
    };
  }, []);

  if (state === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "14px",
        transform: "translateX(-50%)",
        zIndex: 9999,
        maxWidth: "calc(100vw - 28px)",
        padding: "9px 13px",
        borderRadius: "999px",
        background: state === "error" ? "rgba(90,20,32,.96)" : "rgba(8,18,46,.96)",
        border: "1px solid rgba(124,159,255,.45)",
        color: "#f7f9ff",
        fontSize: ".78rem",
        boxShadow: "0 8px 26px rgba(0,0,0,.28)",
        textAlign: "center",
      }}
    >
      {detail}
    </div>
  );
}
