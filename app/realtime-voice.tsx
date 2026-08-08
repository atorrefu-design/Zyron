"use client";

import { useEffect, useRef, useState } from "react";

export type RealtimeVoiceState = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "error";

type RealtimeVoiceProps = {
  disabled?: boolean;
  onStateChange?: (state: RealtimeVoiceState) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onError?: (message: string) => void;
};

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  error?: { message?: string; code?: string };
};

type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isBriefingQuery(message: string) {
  const clean = normalize(message).replace(/\s+/g, " ").trim();
  return /\b(ponme al dia|ponme al corriente|briefing|resumeme el dia|resumen del dia|como tengo el dia|que necesito saber ahora|que deberia saber ahora|que es importante hoy)\b/.test(clean);
}

function isMobilityQuery(message: string) {
  const clean = normalize(message);
  return /\b(trafico|ruta|trayecto|cuanto tardo|cuanto tardare|hora de salir|hora tengo que salir|cuando tengo que salir|cuando debo salir|a que hora salgo|a que hora tengo que salir|llego a tiempo|llegare a tiempo|salida recomendada|trabajo|oficina)\b/.test(clean);
}

function currentDeviceLocation() {
  return new Promise<DeviceLocation | null>((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}

async function queryZyronCore(query: string) {
  if (isBriefingQuery(query)) {
    const response = await fetch("/api/briefing", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
    if (!response.ok) throw new Error(data.error || `briefing_${response.status}`);
    return data.reply?.trim() || "No he podido obtener el briefing.";
  }

  const deviceLocation = isMobilityQuery(query) ? await currentDeviceLocation() : null;
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      deviceLocation,
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
  if (!response.ok) throw new Error(data.error || `core_${response.status}`);
  return data.reply?.trim() || "El núcleo no ha devuelto información.";
}

export default function RealtimeVoice({
  disabled = false,
  onStateChange,
  onUserTranscript,
  onAssistantTranscript,
  onError,
}: RealtimeVoiceProps) {
  const [state, setState] = useState<RealtimeVoiceState>("ready");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userSeenRef = useRef(new Set<string>());
  const assistantSeenRef = useRef(new Set<string>());
  const callbacksRef = useRef({ onStateChange, onUserTranscript, onAssistantTranscript, onError });

  useEffect(() => {
    callbacksRef.current = { onStateChange, onUserTranscript, onAssistantTranscript, onError };
  }, [onStateChange, onUserTranscript, onAssistantTranscript, onError]);

  function updateState(next: RealtimeVoiceState) {
    setState(next);
    callbacksRef.current.onStateChange?.(next);
  }

  function reportError(message: string) {
    updateState("error");
    callbacksRef.current.onError?.(message);
  }

  function sendEvent(event: Record<string, unknown>) {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }

  async function runTool(event: RealtimeEvent) {
    if (event.name !== "consultar_nucleo_zyron" || !event.call_id) return;
    let query = "";
    try {
      const args = JSON.parse(event.arguments || "{}") as { query?: string };
      query = args.query?.trim() || "";
    } catch {
      query = "";
    }

    if (!query) {
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: event.call_id, output: "No se recibió una consulta válida." },
      });
      sendEvent({ type: "response.create" });
      return;
    }

    updateState("thinking");
    try {
      const result = await queryZyronCore(query);
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: event.call_id, output: result },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "error_desconocido";
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: event.call_id, output: `No he podido consultar el núcleo privado: ${detail}.` },
      });
    }
    sendEvent({ type: "response.create" });
  }

  function handleEvent(raw: string) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        updateState("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        updateState("thinking");
        break;
      case "response.created":
        updateState("thinking");
        break;
      case "response.output_audio.delta":
        updateState("speaking");
        break;
      case "response.output_audio.done":
        updateState("listening");
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = event.transcript?.trim();
        const key = event.item_id || text || "";
        if (text && key && !userSeenRef.current.has(key)) {
          userSeenRef.current.add(key);
          callbacksRef.current.onUserTranscript?.(text);
        }
        break;
      }
      case "response.output_audio_transcript.done": {
        const text = event.transcript?.trim();
        const key = event.item_id || text || "";
        if (text && key && !assistantSeenRef.current.has(key)) {
          assistantSeenRef.current.add(key);
          callbacksRef.current.onAssistantTranscript?.(text);
        }
        break;
      }
      case "response.function_call_arguments.done":
        void runTool(event);
        break;
      case "error":
        if (event.error?.message) callbacksRef.current.onError?.(event.error.message);
        break;
      default:
        break;
    }
  }

  async function start() {
    if (disabled || pcRef.current) return;
    updateState("connecting");
    userSeenRef.current.clear();
    assistantSeenRef.current.clear();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audioRef.current = audio;
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        audio.srcObject = remoteStream;
        void audio.play().catch(() => undefined);
      };

      const channel = pc.createDataChannel("oai-events");
      dcRef.current = channel;
      channel.onopen = () => updateState("listening");
      channel.onmessage = (message) => handleEvent(String(message.data));
      channel.onerror = () => reportError("La conexión de voz en tiempo real ha fallado.");
      channel.onclose = () => {
        if (pcRef.current) stop(false);
      };

      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(pc.connectionState) && pcRef.current) {
          reportError("Se ha perdido la conversación de voz.");
          stop(false);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const response = await fetch("/api/realtime/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: offer.sdp }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`realtime_${response.status}`);
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error) {
      const detail = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Necesito permiso de micrófono para iniciar la conversación."
        : "No he podido iniciar la voz en tiempo real.";
      reportError(detail);
      stop(false);
    }
  }

  function stop(resetState = true) {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    audioRef.current = null;
    if (resetState) updateState("ready");
  }

  useEffect(() => () => stop(false), []);

  const active = state !== "ready" && state !== "error";
  const label = state === "connecting"
    ? "Conectando conversación…"
    : state === "listening"
      ? "Te escucho…"
      : state === "thinking"
        ? "Pensando…"
        : state === "speaking"
          ? "Hablando contigo…"
          : state === "error"
            ? "La voz en tiempo real necesita reiniciarse"
            : "Toca el núcleo para iniciar una conversación";

  return (
    <>
      <button
        type="button"
        className={`orb ${active ? state : ""}`}
        onClick={() => active ? stop() : void start()}
        disabled={disabled || state === "connecting"}
        aria-label={active ? "Terminar conversación por voz" : "Hablar con ZYRON"}
      >
        {state === "connecting" || state === "thinking" ? "…" : active ? "■" : "●"}
      </button>
      <div>
        <strong>{label}</strong>
        <div className="voiceHint">🎙️ Conversación en tiempo real: habla con normalidad, interrúmpeme si quieres y continúa sin volver a tocar el botón.</div>
      </div>
    </>
  );
}
