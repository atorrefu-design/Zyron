"use client";

import { useCallback, useEffect, useState } from "react";

type TelegramStatus = {
  configuration: {
    ready: boolean;
    missing: string[];
    invalid: string[];
    botToken: boolean;
    webhookSecret: boolean;
    publicUrl: boolean;
  };
  connected: boolean;
  binding: { displayName: string | null; updatedAt: string } | null;
  bot: { id: number; firstName: string; username: string | null } | null;
  webhook: {
    active: boolean;
    url: string | null;
    pendingUpdates: number;
    lastErrorAt: string | null;
    lastError: string | null;
  } | null;
  error?: string;
};

type TelegramSetup = {
  bot?: { firstName: string; username: string | null };
  pairing?: { code: string; expiresAt: string };
  error?: string;
};

export default function ChannelsPage() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [pairing, setPairing] = useState<NonNullable<TelegramSetup["pairing"]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/channels/telegram", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as TelegramStatus;
      if (!response.ok) throw new Error(data.error || "No se ha podido consultar Telegram");
      setStatus(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se ha podido consultar Telegram");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function activate() {
    if (acting) return;
    setActing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/channels/telegram", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as TelegramSetup;
      if (!response.ok || !data.pairing) throw new Error(data.error || "No se ha podido activar Telegram");
      setPairing(data.pairing);
      setMessage("Webhook activado. Envía el código al bot desde tu Telegram.");
      await loadStatus();
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "No se ha podido activar Telegram");
    } finally {
      setActing(false);
    }
  }

  async function disconnect() {
    if (acting || !window.confirm("¿Desactivar Telegram y su vinculación con ZYRON?")) return;
    setActing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/channels/telegram", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se ha podido desactivar Telegram");
      setPairing(null);
      setMessage("Telegram se ha desactivado.");
      await loadStatus();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "No se ha podido desactivar Telegram");
    } finally {
      setActing(false);
    }
  }

  const botUrl = status?.bot?.username ? `https://t.me/${status.bot.username}` : null;
  const missing = [...(status?.configuration.missing ?? []), ...(status?.configuration.invalid ?? [])];

  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">ZYRON</div>
          <div className={`status ${status?.connected ? "state-ready" : ""}`}>
            ● {loading ? "Comprobando canales" : status?.connected ? "Telegram conectado" : "Canales privados"}
          </div>
        </div>
        <a className="ghostButton navLink" href="/">Volver</a>
      </header>

      <section className="panel channelsPanel">
        <div className="eyebrow">Núcleo cloud · canales externos</div>
        <h1>Canales</h1>
        <p className="subtitle">
          Conecta ZYRON a servicios de mensajería sin exponer la web, la memoria ni las herramientas a otras personas.
        </p>

        {error ? <p className="taskError" role="alert">{error}</p> : null}
        {message ? <p className="memorySuccess" aria-live="polite">{message}</p> : null}

        <article className="channelCard">
          <div className="channelCardHeader">
            <div>
              <div className="channelIcon" aria-hidden="true">✈</div>
              <div>
                <h2>Telegram</h2>
                <p>{status?.connected ? "Vinculado exclusivamente contigo" : "Primer canal externo recomendado"}</p>
              </div>
            </div>
            <span className={`channelBadge ${status?.connected ? "connected" : ""}`}>
              {status?.connected ? "Conectado" : status?.webhook?.active ? "Pendiente de vincular" : "Inactivo"}
            </span>
          </div>

          <div className="channelGrid">
            <div><span>Bot</span><strong>{status?.bot?.username ? `@${status.bot.username}` : "Sin configurar"}</strong></div>
            <div><span>Webhook</span><strong>{status?.webhook?.active ? "Activo" : "Inactivo"}</strong></div>
            <div><span>Propietario</span><strong>{status?.binding?.displayName || (status?.connected ? "Vinculado" : "Sin vincular")}</strong></div>
            <div><span>Actualizaciones pendientes</span><strong>{status?.webhook?.pendingUpdates ?? "—"}</strong></div>
          </div>

          {status?.webhook?.lastError ? (
            <p className="taskError">Telegram: {status.webhook.lastError}</p>
          ) : null}

          {pairing ? (
            <div className="pairingBox">
              <span>Código privado, válido durante 15 minutos</span>
              <code>{pairing.code}</code>
              <p>
                {botUrl ? <a href={botUrl} target="_blank" rel="noreferrer">Abre el bot</a> : "Abre el bot"} y envía: <strong>/pair {pairing.code}</strong>
              </p>
              <small>Caduca: {new Date(pairing.expiresAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</small>
            </div>
          ) : null}

          {!status?.configuration.ready ? (
            <div className="channelNotice">
              <strong>Configuración protegida pendiente</strong>
              <p>
                Primero hay que crear el bot con <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> y guardar sus credenciales en Vercel. No se introducirán secretos en esta página.
              </p>
              {missing.length ? <small>Pendiente: {missing.join(", ")}</small> : null}
            </div>
          ) : null}

          <div className="channelActions">
            <button type="button" onClick={() => void activate()} disabled={acting || !status?.configuration.ready}>
              {acting ? "Procesando…" : status?.connected ? "Generar nueva vinculación" : "Activar y generar código"}
            </button>
            <button type="button" className="ghostButton dangerButton" onClick={() => void disconnect()} disabled={acting || (!status?.connected && !status?.webhook?.active)}>
              Desactivar
            </button>
            <button type="button" className="ghostButton" onClick={() => void loadStatus()} disabled={acting || loading}>
              Actualizar estado
            </button>
          </div>
        </article>

        <section className="channelSecurity">
          <h2>Protección aplicada</h2>
          <ul>
            <li>Telegram firma cada webhook con un secreto exclusivo.</li>
            <li>Solo el chat privado vinculado puede usar el núcleo agente.</li>
            <li>Las actualizaciones repetidas no vuelven a ejecutar acciones.</li>
            <li>El historial del canal caduca; la memoria permanente sigue separada.</li>
          </ul>
        </section>
      </section>
    </main>
  );
}
