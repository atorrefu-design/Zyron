"use client";

import { useEffect } from "react";

const SILENT_WAV = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export default function VoiceBridge() {
  useEffect(() => {
    if (!("speechSynthesis" in window) || !("Audio" in window)) return;

    const synth = window.speechSynthesis;
    const nativeSpeak = synth.speak.bind(synth);
    const nativeCancel = synth.cancel.bind(synth);
    const audio = new Audio();
    audio.preload = "auto";

    let primed = false;
    let activeController: AbortController | null = null;
    let activeUrl: string | null = null;

    const cleanupUrl = () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    };

    const primeAudio = () => {
      if (primed) return;
      primed = true;
      try {
        audio.src = SILENT_WAV;
        audio.volume = 0.01;
        const promise = audio.play();
        if (promise) {
          void promise.then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1;
          }).catch(() => {
            audio.volume = 1;
          });
        }
      } catch {
        audio.volume = 1;
      }
    };

    const pointerPrime = () => primeAudio();
    window.addEventListener("pointerdown", pointerPrime, { passive: true });
    window.addEventListener("touchend", pointerPrime, { passive: true });

    const generatedSpeak = async (utterance: SpeechSynthesisUtterance) => {
      const text = utterance.text?.trim();
      if (!text) {
        nativeSpeak(utterance);
        return;
      }

      activeController?.abort();
      activeController = new AbortController();
      const controller = activeController;

      try {
        const response = await fetch("/api/voice/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`tts_${response.status}`);

        const blob = await response.blob();
        if (controller.signal.aborted) return;

        cleanupUrl();
        activeUrl = URL.createObjectURL(blob);
        audio.src = activeUrl;
        audio.volume = 1;
        audio.currentTime = 0;

        audio.onplay = () => {
          try { utterance.onstart?.({ utterance } as SpeechSynthesisEvent); } catch { /* noop */ }
        };
        audio.onended = () => {
          cleanupUrl();
          try { utterance.onend?.({ utterance } as SpeechSynthesisEvent); } catch { /* noop */ }
        };
        audio.onerror = () => {
          cleanupUrl();
          audio.onplay = null;
          audio.onended = null;
          audio.onerror = null;
          nativeSpeak(utterance);
        };

        await audio.play();
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("ZYRON_GENERATED_VOICE_FALLBACK", error);
        cleanupUrl();
        audio.onplay = null;
        audio.onended = null;
        audio.onerror = null;
        nativeSpeak(utterance);
      }
    };

    try {
      synth.speak = ((utterance: SpeechSynthesisUtterance) => {
        void generatedSpeak(utterance);
      }) as typeof synth.speak;
      synth.cancel = (() => {
        activeController?.abort();
        activeController = null;
        audio.pause();
        audio.currentTime = 0;
        audio.onplay = null;
        audio.onended = null;
        audio.onerror = null;
        cleanupUrl();
        nativeCancel();
      }) as typeof synth.cancel;
    } catch (error) {
      console.warn("ZYRON_VOICE_BRIDGE_UNAVAILABLE", error);
    }

    return () => {
      window.removeEventListener("pointerdown", pointerPrime);
      window.removeEventListener("touchend", pointerPrime);
      activeController?.abort();
      audio.pause();
      cleanupUrl();
      try {
        synth.speak = nativeSpeak as typeof synth.speak;
        synth.cancel = nativeCancel as typeof synth.cancel;
      } catch {
        // Browser may expose non-writable speech methods.
      }
    };
  }, []);

  return null;
}
