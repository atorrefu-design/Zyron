"use client";

import { useEffect, useState } from "react";

type Snapshot = {
  google?: { connected: boolean; scope?: string; email?: string };
  telegram?: { connected: boolean; webhook?: { active: boolean; pendingUpdates: number; lastError?: string } };
  ai?: { providers: { provider: string; configured: boolean; model: string; transport: string }[] };
};

export default function ConnectionsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setChecking(true); setSnapshot({}); setFailed([]);
    const endpoints = { google: "/api/google/status", telegram: "/api/channels/telegram", ai: "/api/ai/providers" };
    Promise.allSettled(Object.entries(endpoints).map(async ([name, url]) => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(name);
      return { name, value: await response.json() };
    })).then((results) => {
      if (controller.signal.aborted) return;
      const next: Record<string, unknown> = {};
      const errors: string[] = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") next[result.value.name] = result.value.value;
        else errors.push(Object.keys(endpoints)[i]);
      });
      setSnapshot(next as Snapshot); setFailed(errors); setChecking(false);
    });
    return () => controller.abort();
  }, [revision]);
  const scopes = snapshot.google?.scope?.split(" ") || [];
  return <main className="shell">
    <header className="topbar"><span className="brand">ZYRON</span><a href="/" className="ghostButton navLink">Volver al núcleo</a></header>
    <section className="memoryPanel">
      <p className="eyebrow">CENTRO DE CONEXIONES</p><h1>Sus herramientas, bajo control.</h1>
      <p>La memoria y las herramientas del servidor pertenecen al mismo núcleo. Las acciones del dispositivo dependen del canal y de los permisos concedidos.</p>
      <button className="ghostButton" disabled={checking} onClick={() => setRevision((n) => n + 1)}>{checking ? "Comprobando…" : "Comprobar de nuevo"}</button>
      {failed.length > 0 && <p role="status">No se pudo comprobar: {failed.join(", ")}. Un estado desconocido no confirma una desconexión.</p>}
    </section>
    <div className="connectionGrid">
      <section className="memoryPanel"><p className="eyebrow">GOOGLE</p><h2>{snapshot.google ? snapshot.google.connected ? "Cuenta vinculada" : "Sin vincular" : "Estado sin comprobar"}</h2>
        <p>{snapshot.google?.email || "Calendario, Gmail, Drive y documentos mediante autorización de Google."}</p>
        <p>Los permisos concedidos determinan qué operaciones están disponibles. La vinculación por sí sola no verifica una escritura.</p>
        {scopes.length > 0 && <details><summary>Permisos concedidos</summary><ul className="scopeList">{scopes.map((scope) => <li key={scope}>{scope}</li>)}</ul></details>}
        <a className="ghostButton navLink" href="/api/google/connect">Revisar autorización Google</a>
      </section>
      <section className="memoryPanel"><p className="eyebrow">TELEGRAM</p><h2>{snapshot.telegram ? snapshot.telegram.connected && snapshot.telegram.webhook?.active ? "Canal vinculado" : "Requiere configuración" : "Estado sin comprobar"}</h2>
        <p>Comparte memoria, tareas y herramientas del núcleo. El historial de mensajes sigue siendo propio de cada canal.</p>
        {snapshot.telegram?.webhook && <p>Mensajes en cola: {snapshot.telegram.webhook.pendingUpdates}. {snapshot.telegram.webhook.lastError ? "Existe un error registrado; revise el canal." : "Sin error notificado en esta consulta."}</p>}
        <a className="ghostButton navLink" href="/channels">Gestionar Telegram</a>
      </section>
      <section className="memoryPanel"><p className="eyebrow">CONVERSACIÓN OPCIONAL</p><h2>Motores de IA</h2>
        {snapshot.ai?.providers.map((provider) => <p key={provider.provider}><strong>{provider.provider}</strong> · {provider.configured ? "Configurado; inferencia no comprobada" : "Sin configurar"}<br/><small>{provider.model || "Modelo pendiente"} · {provider.transport}</small></p>)}
        <p>Las cuentas gratuitas de las apps no conceden automáticamente acceso a sus APIs. Gemini puede tener cuota gratuita; los modelos locales necesitan un servidor propio accesible para Zyron.</p>
      </section>
      <section className="memoryPanel"><p className="eyebrow">IPHONE Y OTROS DISPOSITIVOS</p><h2>Acciones del dispositivo</h2>
        <p>Bluetooth y automatizaciones: Atajos o companion instalado. Abrir apps, navegación y permisos nativos requieren intervención del iPhone. Esta web no puede comprobar todas las apps instaladas.</p>
        <p>La voz continua requiere micrófono y un proveedor. La lectura de respuestas utiliza las voces disponibles del dispositivo.</p>
        <a className="ghostButton navLink" href="/dashboard">Ver capacidades</a>
        <a className="ghostButton navLink" href="/memory">Consultar y editar memoria</a>
      </section>
    </div>
  </main>;
}
