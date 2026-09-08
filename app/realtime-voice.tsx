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

type RealtimeCallError = {
  error?: string;
  code?: string;
  detail?: string;
  upstreamStatus?: number;
};

type PlaceSearchResult = {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  openNow: boolean | null;
  googleMapsUri: string | null;
};

type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

type RecentTurn = { role: "user" | "assistant"; text: string };

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

function needsLocationContext(message: string) {
  const clean = normalize(message);
  return isMobilityQuery(message)
    || /\b(tiempo|clima|lluvia|temperatura|prevision|pronostico|cerca de mi|donde estoy)\b/.test(clean);
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

async function queryZyronCore(query: string, recentTurns: RecentTurn[]) {
  if (isBriefingQuery(query)) {
    const response = await fetch("/api/briefing", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
    if (!response.ok) throw new Error(data.error || `briefing_${response.status}`);
    return data.reply?.trim() || "No he podido obtener el briefing.";
  }

  const deviceLocation = needsLocationContext(query) ? await currentDeviceLocation() : null;
  const messages = recentTurns.slice(-10).map((turn) => ({ role: turn.role, content: turn.text }));
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || normalize(last.content) !== normalize(query)) {
    messages.push({ role: "user", content: query });
  }
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      deviceLocation,
      channel: "web",
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
  if (!response.ok) throw new Error(data.error || `core_${response.status}`);
  return data.reply?.trim() || "El núcleo no ha devuelto información.";
}

async function searchRealPlaces(query: string) {
  const location = await currentDeviceLocation();
  const response = await fetch("/api/places/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      latitude: location?.latitude,
      longitude: location?.longitude,
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    places?: PlaceSearchResult[];
    error?: string;
    detail?: string;
  };
  if (!response.ok) throw new Error(data.detail || data.error || `places_${response.status}`);

  const places = data.places ?? [];
  if (!places.length) return "No se han encontrado lugares que encajen con esa búsqueda.";

  return JSON.stringify({
    source: "Google Places",
    query,
    places: places.map((place) => ({
      name: place.name,
      address: place.address,
      rating: place.rating,
      reviewCount: place.reviewCount,
      openNow: place.openNow,
      googleMapsUri: place.googleMapsUri,
    })),
  });
}

function friendlyRealtimeError(data: RealtimeCallError, status: number) {
  if (data.code === "openai_key_rejected") return "OpenAI ha rechazado la clave API de ZYRON.";
  if (data.code === "openai_quota_exhausted") return "La cuenta API de ZYRON se ha quedado sin crédito.";
  if (data.code === "openai_realtime_forbidden") return "La cuenta API todavía no tiene acceso al modelo de conversación Realtime.";
  if (data.code === "openai_rate_limited") return "OpenAI está limitando temporalmente las conversaciones Realtime.";
  if (data.detail) return data.detail;
  return `No he podido abrir la conversación Realtime (${status}).`;
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
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const activeRef = useRef(false);
  const connectingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  const reconnectingRef = useRef(false);
  const recentTurnsRef = useRef<RecentTurn[]>([]);
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

  function rememberTurn(role: RecentTurn["role"], text: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    recentTurnsRef.current = [...recentTurnsRef.current, { role, text: clean }].slice(-8);
  }

  async function requestScreenWakeLock() {
    if (document.visibilityState !== "visible" || !activeRef.current) return;
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock || (wakeLockRef.current && !wakeLockRef.current.released)) return;
    try {
      wakeLockRef.current = await wakeLock.request("screen");
    } catch {
      // Wake Lock is best effort. Recovery below handles iOS suspensions.
    }
  }

  async function releaseScreenWakeLock() {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel || sentinel.released) return;
    await sentinel.release().catch(() => undefined);
  }

  function setMediaSessionPlaying(playing: boolean) {
    if (!("mediaSession" in navigator)) return;
    try {
      if (playing) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Conversación con ZYRON",
          artist: "ZYRON",
          album: "Asistente personal",
        });
        navigator.mediaSession.playbackState = "playing";
        navigator.mediaSession.setActionHandler("play", () => {
          void audioRef.current?.play().catch(() => undefined);
        });
      } else {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      }
    } catch {
      // Media Session support varies between Safari contexts.
    }
  }

  async function resumeRemoteAudio() {
    const audio = audioRef.current;
    if (!audio) return false;
    try {
      await audio.play();
      setMediaSessionPlaying(true);
      return true;
    } catch {
      return false;
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current === null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }

  function transportLooksHealthy() {
    const pc = pcRef.current;
    const channel = dcRef.current;
    const track = streamRef.current?.getAudioTracks()[0];
    return Boolean(
      pc
      && pc.connectionState === "connected"
      && channel
      && channel.readyState === "open"
      && track
      && track.readyState === "live",
    );
  }

  function teardownTransport() {
    clearReconnectTimer();

    const channel = dcRef.current;
    dcRef.current = null;
    if (channel) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onerror = null;
      channel.onclose = null;
      channel.close();
    }

    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioRef.current) {
      audioRef.current.onpause = null;
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current.remove();
    }
    audioRef.current = null;
    connectingRef.current = false;
  }

  function sendEvent(event: Record<string, unknown>) {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }

  function restoreRecentContext() {
    if (!reconnectingRef.current || !recentTurnsRef.current.length) return;
    const transcript = recentTurnsRef.current
      .map((turn) => `${turn.role === "user" ? "Aarón" : "ZYRON"}: ${turn.text}`)
      .join("\n")
      .slice(-3500);

    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: `Contexto técnico de una reconexión tras suspenderse el iPhone. No respondas a este mensaje por sí solo; úsalo únicamente para continuar el siguiente turno con coherencia:\n${transcript}`,
        }],
      },
    });
    reconnectingRef.current = false;
  }

  function attachTrackRecovery(track: MediaStreamTrack) {
    track.onended = () => {
      if (activeRef.current) scheduleRecovery(350);
    };
  }

  async function refreshMicrophone() {
    const pc = pcRef.current;
    if (!pc || !activeRef.current || document.visibilityState !== "visible") return false;

    try {
      const replacementStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const replacementTrack = replacementStream.getAudioTracks()[0];
      const sender = pc.getSenders().find((candidate) => candidate.track?.kind === "audio");
      if (!replacementTrack || !sender) {
        replacementStream.getTracks().forEach((track) => track.stop());
        return false;
      }

      await sender.replaceTrack(replacementTrack);
      attachTrackRecovery(replacementTrack);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = replacementStream;
      return true;
    } catch {
      return false;
    }
  }

  function scheduleRecovery(delay = 700) {
    if (!activeRef.current || document.visibilityState !== "visible") return;
    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void recoverAfterSuspension();
    }, delay);
  }

  async function recoverAfterSuspension() {
    if (!activeRef.current || connectingRef.current || document.visibilityState !== "visible") return;

    await requestScreenWakeLock();
    const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
    hiddenAtRef.current = null;

    if (transportLooksHealthy()) {
      const audioReady = await resumeRemoteAudio();
      const microphoneReady = hiddenFor > 700 ? await refreshMicrophone() : true;
      if (audioReady && microphoneReady) {
        recoveryAttemptsRef.current = 0;
        updateState("listening");
        return;
      }
    }

    if (recoveryAttemptsRef.current >= 2) {
      reportError("iOS ha suspendido la conversación y no he podido recuperarla automáticamente. Toca el núcleo para reconectar.");
      teardownTransport();
      activeRef.current = false;
      return;
    }

    recoveryAttemptsRef.current += 1;
    reconnectingRef.current = true;
    teardownTransport();
    await start(true);
  }

  useEffect(() => {
    const handleVisibility = () => {
      if (!activeRef.current) return;
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      void requestScreenWakeLock();
      scheduleRecovery(250);
    };

    const handlePageShow = () => {
      if (activeRef.current) scheduleRecovery(250);
    };

    const handleOnline = () => {
      if (activeRef.current) scheduleRecovery(300);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  async function runTool(event: RealtimeEvent) {
    if (!event.call_id || !event.name) return;
    if (event.name !== "consultar_nucleo_zyron" && event.name !== "buscar_lugares_reales") return;

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
      const result = event.name === "buscar_lugares_reales"
        ? await searchRealPlaces(query)
        : await queryZyronCore(query, recentTurnsRef.current);
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: event.call_id, output: result },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "error_desconocido";
      const prefix = event.name === "buscar_lugares_reales"
        ? "No he podido buscar lugares reales"
        : "No he podido consultar el núcleo privado";
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: event.call_id, output: `${prefix}: ${detail}.` },
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
      case "response.audio.delta":
        updateState("speaking");
        break;
      case "response.output_audio.done":
      case "response.audio.done":
        updateState("listening");
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = event.transcript?.trim();
        const key = event.item_id || text || "";
        if (text && key && !userSeenRef.current.has(key)) {
          userSeenRef.current.add(key);
          rememberTurn("user", text);
          callbacksRef.current.onUserTranscript?.(text);
        }
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const text = event.transcript?.trim();
        const key = event.item_id || text || "";
        if (text && key && !assistantSeenRef.current.has(key)) {
          assistantSeenRef.current.add(key);
          rememberTurn("assistant", text);
          callbacksRef.current.onAssistantTranscript?.(text);
        }
        break;
      }
      case "response.function_call_arguments.done":
        void runTool(event);
        break;
      case "error":
        if (event.error?.message) reportError(event.error.message);
        break;
      default:
        break;
    }
  }

  async function start(recovery = false) {
    if (disabled || connectingRef.current || (!recovery && pcRef.current)) return;
    connectingRef.current = true;
    activeRef.current = true;
    updateState("connecting");
    void requestScreenWakeLock();

    if (!recovery) {
      recoveryAttemptsRef.current = 0;
      reconnectingRef.current = false;
      recentTurnsRef.current = [];
      userSeenRef.current.clear();
      assistantSeenRef.current.clear();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach(attachTrackRecovery);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      audio.volume = 1;
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioRef.current = audio;
      audio.onpause = () => {
        if (activeRef.current && document.visibilityState === "visible") {
          window.setTimeout(() => void resumeRemoteAudio(), 120);
        }
      };

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        audio.srcObject = remoteStream;
        void resumeRemoteAudio().then((played) => {
          if (!played) callbacksRef.current.onError?.("El iPhone ha bloqueado el audio remoto. Toca el núcleo si no se recupera solo.");
        });
      };

      const channel = pc.createDataChannel("oai-events");
      dcRef.current = channel;
      channel.onopen = () => {
        connectingRef.current = false;
        recoveryAttemptsRef.current = 0;
        updateState("listening");
        void requestScreenWakeLock();
        void resumeRemoteAudio();
        restoreRecentContext();
      };
      channel.onmessage = (message) => handleEvent(String(message.data));
      channel.onerror = () => {
        if (activeRef.current) scheduleRecovery(350);
      };
      channel.onclose = () => {
        if (activeRef.current) scheduleRecovery(350);
      };

      pc.onconnectionstatechange = () => {
        if (!activeRef.current) return;
        if (pc.connectionState === "connected") {
          recoveryAttemptsRef.current = 0;
          return;
        }
        if (pc.connectionState === "disconnected") {
          scheduleRecovery(1600);
          return;
        }
        if (pc.connectionState === "failed") {
          scheduleRecovery(250);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const localSdp = pc.localDescription?.sdp || offer.sdp || "";
      if (!localSdp) throw new Error("No se ha generado la oferta de audio del iPhone.");

      const response = await fetch("/api/realtime/call", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: localSdp,
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as RealtimeCallError;
        throw new Error(friendlyRealtimeError(data, response.status));
      }

      const answerSdp = await response.text();
      if (!answerSdp.trim().startsWith("v=0")) {
        throw new Error("OpenAI no ha devuelto una respuesta WebRTC válida.");
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      connectingRef.current = false;
    } catch (error) {
      connectingRef.current = false;
      teardownTransport();

      const detail = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Necesito permiso de micrófono para iniciar la conversación."
        : error instanceof Error && /No AVAudioSessionCaptureDevice/i.test(error.message)
          ? "iOS ha perdido temporalmente el dispositivo de audio. Recarga ZYRON y vuelve a iniciar la conversación."
          : error instanceof Error && error.message
            ? error.message
            : "No he podido iniciar la voz en tiempo real.";

      if (recovery && activeRef.current && recoveryAttemptsRef.current < 2) {
        scheduleRecovery(900);
        return;
      }

      reportError(detail);
      activeRef.current = false;
      void releaseScreenWakeLock();
      setMediaSessionPlaying(false);
    }
  }

  function stop(resetState = true) {
    activeRef.current = false;
    hiddenAtRef.current = null;
    recoveryAttemptsRef.current = 0;
    reconnectingRef.current = false;
    clearReconnectTimer();
    void releaseScreenWakeLock();
    setMediaSessionPlaying(false);
    teardownTransport();
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
            ? "La voz necesita reconectarse"
            : "Toca el núcleo para iniciar una conversación";

  return (
    <>
      <div className={`arcCore state-${state}`}>
        <i className="arcRing ringOne" /><i className="arcRing ringTwo" /><i className="arcRing ringThree" />
        <button
          type="button"
          className={`orb ${active ? state : ""}`}
          onClick={() => active ? stop() : void start()}
          disabled={disabled || state === "connecting"}
          aria-label={active ? "Terminar conversación por voz" : "Hablar con ZYRON"}
        >
          {state === "connecting" || state === "thinking" ? "…" : active ? "■" : "Z"}
        </button>
      </div>
      <div className="voiceCopy">
        <strong>{label}</strong>
        <div className="voiceHint">Conversación continua, interrumpible y conectada al mismo núcleo, memoria y herramientas de ZYRON.</div>
      </div>
    </>
  );
}
