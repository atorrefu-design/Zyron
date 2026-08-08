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

type CommuteProfile = {
  destination: string;
  arrivalTime: string;
  bufferMinutes: number;
  weekdays: number[];
  enabled: boolean;
  originSaved: boolean;
  updatedAt: string;
};

type CommuteResponse = { profile?: CommuteProfile | null; error?: string };
type GeolocationErrorLike = { code?: number };
type Coordinates = { latitude: number; longitude: number };

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

function googleDiagnostic(value: string) {
  const separator = value.indexOf(":");
  if (separator < 0) return "";
  return value.slice(separator + 1).trim().slice(0, 220);
}

function routeErrorMessage(value: string) {
  if (value === "maps_not_configured") return "Falta configurar Google Routes en el servidor.";
  if (/API key not valid|The key you provided is invalid|missing a valid API key/i.test(value)) {
    return "La clave de Google Maps configurada en ZYRON no es válida. Crea una nueva API key en Google Cloud, restríngela a Routes API y sustituye GOOGLE_MAPS_API_KEY en Vercel.";
  }
  if (/maps_routes_403/.test(value)) return "Google Routes ha rechazado la clave. Revisa que Routes API esté habilitada, que la clave permita Routes API y que el proyecto tenga facturación activa.";
  if (/maps_routes_400/.test(value)) {
    const diagnostic = googleDiagnostic(value);
    return diagnostic
      ? `Google Routes devuelve: ${diagnostic}`
      : "Google ha rechazado algún parámetro de la ruta. He activado diagnóstico para identificar cuál.";
  }
  if (/maps_route_unavailable/.test(value)) return "Google no ha encontrado una ruta válida para ese destino. Añade municipio o código postal para concretarlo.";
  if (/maps_routes_429/.test(value)) return "Google Routes ha aplicado un límite temporal. Espera unos segundos y vuelve a probar.";
  return "No he podido calcular la ruta. Revisa la configuración de Maps y vuelve a intentarlo.";
}

function arrivalClock(value: string) {
  const match = value.match(/T(\d{2}:\d{2})/);
  return match?.[1] || "";
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
  const [lastOrigin, setLastOrigin] = useState<Coordinates | null>(null);
  const [commute, setCommute] = useState<CommuteProfile | null>(null);
  const [commuteBusy, setCommuteBusy] = useState(false);
  const [commuteMessage, setCommuteMessage] = useState("");

  useEffect(() => {
    setDestination(localStorage.getItem(DESTINATION_KEY) || "");
    setArrival(localStorage.getItem(ARRIVAL_KEY) || localInputValue(new Date(Date.now() + 60 * 60_000)));
    const storedBuffer = Number(localStorage.getItem(BUFFER_KEY));
    if (Number.isFinite(storedBuffer) && storedBuffer >= 0 && storedBuffer <= 60) setBufferMinutes(storedBuffer);
    void fetch("/api/maps/route", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: ApiResponse) => setConfigured(Boolean(data.configured)))
      .catch(() => setConfigured(false));
    void fetch("/api/maps/commute", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: CommuteResponse) => setCommute(data.profile || null))
      .catch(() => setCommute(null));
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
    setLastOrigin(null);
    setCommuteMessage("");
    setStatus("Localizando el iPhone y consultando tráfico…");
    try {
      const position = await currentPosition();
      const origin = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const body = {
        origin,
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
      setLastOrigin(origin);
      setResult(data.route);
      setStatus("Ruta calculada con tráfico de Google. La ubicación exacta no se guarda salvo que actives los avisos de ruta habitual.");
    } catch (error) {
      const locationError = error as GeolocationErrorLike;
      const message = typeof locationError?.code === "number"
        ? locationError.code === 1
          ? "Necesito permiso de ubicación para calcular desde donde estás ahora."
          : "No he podido obtener tu ubicación actual."
        : routeErrorMessage(error instanceof Error ? error.message : "");
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  async function saveWeekdayWatch() {
    if (!lastOrigin || !result || !useArrival) {
      setCommuteMessage("Calcula primero una ruta con hora de llegada para poder guardar el aviso.");
      return;
    }
    const time = arrivalClock(arrival);
    if (!time) {
      setCommuteMessage("Elige una hora de llegada válida.");
      return;
    }
    setCommuteBusy(true);
    try {
      const response = await fetch("/api/maps/commute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: lastOrigin,
          destination: destination.trim(),
          arrivalTime: time,
          bufferMinutes,
          weekdays: [1, 2, 3, 4, 5],
        }),
      });
      const data = (await response.json().catch(() => ({}))) as CommuteResponse;
      if (!response.ok || !data.profile) throw new Error(data.error || "commute_save_failed");
      setCommute(data.profile);
      setCommuteMessage("Avisos activados de lunes a viernes. ZYRON revisará tráfico desde este punto guardado y te avisará cuando se acerque la hora de salir.");
    } catch {
      setCommuteMessage("No he podido guardar esta ruta habitual. Vuelve a intentarlo.");
    } finally {
      setCommuteBusy(false);
    }
  }

  async function disableWeekdayWatch() {
    setCommuteBusy(true);
    try {
      const response = await fetch("/api/maps/commute", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as CommuteResponse;
      if (!response.ok) throw new Error(data.error || "commute_disable_failed");
      setCommute(data.profile || null);
      setCommuteMessage("Avisos de esta ruta desactivados.");
    } catch {
      setCommuteMessage("No he podido desactivar los avisos de ruta.");
    } finally {
      setCommuteBusy(false);
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

            {useArrival && lastOrigin && (
              <section className="dashboardBlock">
                <div className="blockHeader"><h2>Avisos de ruta habitual</h2><span>{commute?.enabled ? "ACTIVOS" : "OPCIONAL"}</span></div>
                <div className="mutedBox">
                  Si lo activas, ZYRON guardará este punto de salida y el destino en tu base privada para revisar el tráfico cada 15 minutos de lunes a viernes. No sabrá que te has movido después salvo que vuelvas a guardar la ruta desde otra ubicación.
                </div>
                <div className="headerActions">
                  <button className="ghostButton" type="button" disabled={commuteBusy} onClick={() => void saveWeekdayWatch()}>
                    {commuteBusy ? "Guardando…" : commute?.enabled ? "Actualizar ruta y avisos" : "Activar avisos L-V"}
                  </button>
                  {commute?.enabled && (
                    <button className="ghostButton" type="button" disabled={commuteBusy} onClick={() => void disableWeekdayWatch()}>Desactivar</button>
                  )}
                </div>
                {commute?.enabled && (
                  <div className="compactRow"><span>🚗</span><div><strong>{commute.destination}</strong><small>L-V · llegada {commute.arrivalTime} · margen {commute.bufferMinutes} min</small></div></div>
                )}
                {commuteMessage && <div className="mutedBox">{commuteMessage}</div>}
              </section>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
