"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type RouteResult = {
  durationSeconds: number;
  staticDurationSeconds: number | null;
  distanceMeters: number;
  departureTime: string;
  arrivalTime: string;
  trafficDelaySeconds: number | null;
  recommendedDepartureTime?: string;
  targetArrivalTime?: string;
  bufferMinutes?: number;
  leaveInSeconds?: number;
};

type ApiResponse = {
  configured?: boolean;
  mode?: "leave_now" | "arrive_by";
  route?: RouteResult;
  error?: string;
};

const DESTINATION_KEY = "zyron-maps-destination";
const ARRIVAL_KEY = "zyron-maps-arrival";
const BUFFER_KEY = "zyron-maps-buffer";

function localInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(".0", "")} km` : `${Math.round(meters)} m`;
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function MapsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [destination, setDestination] = useState("");
  const [arrival, setArrival] = useState("");
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [useArrival, setUseArrival] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Usaré la ubicación actual del iPhone solo cuando calcules una ruta.");
  const [result, setResult] = useState<RouteResult | null>(null);

  useEffect(() => {
    setDestination(localStorage.getItem(DESTINATION_KEY) || "");
    setArrival(localStorage.getItem(ARRIVAL_KEY) || localInputValue(new Date(Date.now() + 60 * 60_000)));
    const storedBuffer = Number(localStorage.getItem(BUFFER_KEY));
    if (Number.isFinite(storedBuffer) && storedBuffer >= 0 && storedBuffer <= 60) setBufferMinutes(storedBuffer);
    void fetch("/api/maps/route", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: ApiResponse) => setConfigured(Boolean(data.configured)))
      .catch(() => setConfigured(false));
  }, []);

  const mapsUrl = useMemo(() => destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : "https://www.google.com/maps",
  [destination]);

  function currentPosition() {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("geolocation_unsupported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 60_000,
      });
    });
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    const cleanDestination = destination.trim();
    if (!cleanDestination) {
      setStatus("Escribe primero un destino.");
      return;
    }
    if (configured === false) {
      setStatus("El planificador está construido, pero falta conectar la API de Google Routes.");
      return;
    }

    setLoading(true);
    setResult(null);
    setStatus("Localizando el iPhone y consultando tráfico…");
    try {
      const position = await currentPosition();
      const body = {
        origin: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        destination: cleanDestination,
        arrivalTime: useArrival && arrival ? new Date(arrival).toISOString() : null,
        bufferMinutes,
      };
      const response = await fetch("/api/maps/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !data.route) throw new Error(data.error || `maps_${response.status}`);

      localStorage.setItem(DESTINATION_KEY, cleanDestination);
      localStorage.setItem(ARRIVAL_KEY, arrival);
      localStorage.setItem(BUFFER_KEY, String(bufferMinutes));
      setConfigured(true);
      setResult(data.route);
      setStatus("Ruta calculada con tráfico de Google. La ubicación exacta no se guarda en ZYRON.");
    } catch (error) {
      const message = error instanceof GeolocationPositionError
        ? error.code === error.PERMISSION_DENIED
          ? "Necesito permiso de ubicación para calcular desde donde estás ahora."
          : "No he podido obtener tu ubicación actual."
        : error instanceof Error && error.message === "maps_not_configured"
          ? "Falta configurar Google Routes en el servidor."
          : "No he podido calcular la ruta. Revisa la configuración de Maps y vuelve a intentarlo.";
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className="status">● Movilidad</div></div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Hablar</a>
          <a className="ghostButton navLink" href="/dashboard">Panel</a>
        </div>
      </header>

      <section className="panel">
        <div className="eyebrow">Rutas · tráfico · hora de salida</div>
        <h1>Movilidad</h1>
        <p className="subtitle">Calcula desde tu ubicación actual cuánto tardas y cuándo conviene salir para llegar con margen.</p>

        {configured === false && (
          <div className="taskError">Motor de rutas preparado. Falta configurar <b>GOOGLE_MAPS_API_KEY</b> y habilitar Routes API en Google Cloud.</div>
        )}

        <form className="taskForm" onSubmit={calculate}>
          <label>
            Destino
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Ej.: oficina, dirección o nombre del lugar"
              autoComplete="street-address"
            />
          </label>
          <label>
            <span><input type="checkbox" checked={useArrival} onChange={(event) => setUseArrival(event.target.checked)} /> Llegar a una hora concreta</span>
            <input type="datetime-local" value={arrival} disabled={!useArrival} onChange={(event) => setArrival(event.target.value)} />
          </label>
          <label>
            Margen extra
            <select value={bufferMinutes} onChange={(event) => setBufferMinutes(Number(event.target.value))}>
              <option value={0}>Sin margen</option>
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
              <option value={20}>20 min</option>
            </select>
          </label>
          <button type="submit" disabled={loading || configured === false}>{loading ? "Calculando…" : "Calcular con tráfico"}</button>
        </form>

        <div className="mutedBox">{status}</div>

        {result && (
          <section className="dashboardBlock">
            <div className="blockHeader"><h2>Plan de salida</h2><a href={mapsUrl} target="_blank" rel="noreferrer">Abrir en Google Maps</a></div>
            <div className="metricGrid">
              <div className="metricCard"><strong>{formatDuration(result.durationSeconds)}</strong><span>Trayecto estimado</span></div>
              <div className="metricCard"><strong>{formatDistance(result.distanceMeters)}</strong><span>Distancia</span></div>
              <div className="metricCard"><strong>{result.trafficDelaySeconds === null ? "—" : formatDuration(result.trafficDelaySeconds)}</strong><span>Retraso por tráfico</span></div>
              <div className="metricCard"><strong>{formatClock(result.recommendedDepartureTime || result.departureTime)}</strong><span>{result.recommendedDepartureTime ? "Salida recomendada" : "Salida"}</span></div>
            </div>
            <div className="compactRow"><span>◷</span><div><strong>Llegada estimada</strong><small>{formatClock(result.arrivalTime)}{result.bufferMinutes ? ` · margen reservado: ${result.bufferMinutes} min` : ""}</small></div></div>
            {typeof result.leaveInSeconds === "number" && (
              <div className="mutedBox">
                {result.leaveInSeconds <= 0
                  ? "Para llegar con el margen elegido, conviene salir ya."
                  : `Quedan aproximadamente ${formatDuration(result.leaveInSeconds)} para la salida recomendada.`}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
