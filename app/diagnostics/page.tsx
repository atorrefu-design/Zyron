"use client";

import { useEffect, useMemo, useState } from "react";

type HealthState = {
  ok?: boolean;
  service?: string;
  timestamp?: string;
  [key: string]: unknown;
};

type PermissionState = "granted" | "denied" | "prompt" | "unsupported" | "unknown";

function detectStandalone() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || navigatorWithStandalone.standalone === true;
}

function detectIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function permissionState(name: PermissionName): Promise<PermissionState> {
  try {
    if (!("permissions" in navigator)) return "unsupported";
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch {
    return "unsupported";
  }
}

export default function DiagnosticsPage() {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [microphone, setMicrophone] = useState<PermissionState>("unknown");
  const [geolocation, setGeolocation] = useState<PermissionState>("unknown");
  const [secureContext, setSecureContext] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIOS] = useState(false);
  const [mediaDevices, setMediaDevices] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setStandalone(detectStandalone());
    setIOS(detectIOS());
    setSecureContext(window.isSecureContext);
    setMediaDevices(Boolean(navigator.mediaDevices?.getUserMedia));
    setOnline(navigator.onLine);

    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    void permissionState("geolocation").then(setGeolocation);
    // microphone is not universally exposed through the Permissions API on iOS.
    void permissionState("microphone" as PermissionName).then(setMicrophone);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    void fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as HealthState;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setHealth(body);
      })
      .catch((error) => setHealthError(error instanceof Error ? error.message : "Sin respuesta"))
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const runtimeLabel = useMemo(() => {
    if (standalone && ios) return "ZYRON Web instalada en iPhone (PWA)";
    if (standalone) return "ZYRON Web instalada (PWA)";
    if (ios) return "ZYRON Web abierta en Safari del iPhone";
    return "ZYRON Web en navegador";
  }, [ios, standalone]);

  const rows = [
    ["Capa actual", runtimeLabel],
    ["Núcleo cloud", health?.ok ? "Activo" : healthError ? `Error: ${healthError}` : "Comprobando…"],
    ["Internet", online ? "Conectado" : "Sin conexión"],
    ["HTTPS / contexto seguro", secureContext ? "Sí" : "No"],
    ["Micrófono web disponible", mediaDevices ? "Sí" : "No"],
    ["Permiso de micrófono", microphone],
    ["Permiso de ubicación", geolocation],
    ["Modo app instalada", standalone ? "Sí" : "No"],
  ] as const;

  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">ZYRON</div>
          <div className="status state-ready">● Diagnóstico local</div>
        </div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Volver</a>
        </div>
      </header>

      <section className="panel">
        <div className="eyebrow">Sistema privado · diagnóstico</div>
        <h1>Estado de ZYRON</h1>
        <p className="subtitle">
          Esta pantalla distingue la web instalada de la futura app nativa y comprueba las capacidades del iPhone sin necesitar el Mac.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,.12)" }}>
              <strong>{label}</strong>
              <span style={{ textAlign: "right", opacity: 0.85 }}>{String(value)}</span>
            </div>
          ))}
        </div>

        <p className="subtitle" style={{ marginTop: 28 }}>
          La app con icono blanco instalada desde Xcode es el cliente nativo de pruebas. Esta página pertenece a ZYRON Web/PWA, que seguirá funcionando aunque el Mac esté apagado.
        </p>
      </section>
    </main>
  );
}
