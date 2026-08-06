"use client";

import { FormEvent, useEffect, useState } from "react";
import "./calendar.css";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
};

type EventsResponse = { events?: CalendarEvent[]; error?: string; code?: string };
type GoogleStatus = { configured: boolean; connected: boolean; email: string | null; scope: string | null };

const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function localInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatEvent(event: CalendarEvent) {
  if (event.allDay) {
    return new Date(`${event.start}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" });
  }
  return new Date(event.start).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function CalendarPage() {
  const initialStart = new Date(Date.now() + 60 * 60 * 1000);
  initialStart.setMinutes(0, 0, 0);
  const initialEnd = new Date(initialStart.getTime() + 60 * 60 * 1000);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(localInputValue(initialStart));
  const [end, setEnd] = useState(localInputValue(initialEnd));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const canWrite = Boolean(googleStatus?.scope?.includes(WRITE_SCOPE));
  const needsAuthorization = errorCode === "calendar_scope_missing" || errorCode === "calendar_write_scope_missing" || (googleStatus?.connected && !canWrite);

  function resetForm() {
    const nextStart = new Date(Date.now() + 60 * 60 * 1000);
    nextStart.setMinutes(0, 0, 0);
    setEditingId(null);
    setTitle("");
    setStart(localInputValue(nextStart));
    setEnd(localInputValue(new Date(nextStart.getTime() + 60 * 60 * 1000)));
    setLocation("");
    setDescription("");
  }

  function beginEdit(item: CalendarEvent) {
    if (item.allDay) {
      setError("La edición de eventos de día completo llegará en una siguiente mejora.");
      return;
    }
    setError("");
    setSuccess("");
    setEditingId(item.id);
    setTitle(item.title);
    setStart(localInputValue(new Date(item.start)));
    setEnd(localInputValue(new Date(item.end)));
    setLocation(item.location || "");
    setDescription("");
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  async function loadStatus() {
    try {
      const response = await fetch("/api/google/status", { cache: "no-store" });
      const data = (await response.json()) as GoogleStatus;
      if (response.ok) setGoogleStatus(data);
    } catch { setGoogleStatus(null); }
  }

  async function loadEvents() {
    setLoading(true);
    setError("");
    setErrorCode("");
    try {
      const response = await fetch("/api/calendar/events?days=14&limit=30", { cache: "no-store" });
      const data = (await response.json()) as EventsResponse;
      if (!response.ok) {
        setErrorCode(data.code || "");
        throw new Error(data.error || "No he podido leer Google Calendar.");
      }
      setEvents(data.events || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No he podido leer Google Calendar.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void Promise.all([loadStatus(), loadEvents()]); }, []);

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setErrorCode("");
    setSuccess("");
    try {
      const response = await fetch(editingId ? "/api/calendar/events/update" : "/api/calendar/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: editingId || undefined,
          title,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          location: location || null,
          description: description || null,
          timeZone: "Europe/Madrid",
        }),
      });
      const data = (await response.json()) as { error?: string; code?: string; event?: CalendarEvent };
      if (!response.ok) {
        setErrorCode(data.code || "");
        throw new Error(data.error || `No se pudo ${editingId ? "actualizar" : "crear"} el evento.`);
      }
      setSuccess(`Evento “${data.event?.title || title}” ${editingId ? "actualizado" : "creado"} en Google Calendar.`);
      resetForm();
      await Promise.all([loadStatus(), loadEvents()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar el evento.");
    } finally { setSaving(false); }
  }

  async function removeEvent(item: CalendarEvent) {
    if (!canWrite || deletingId) return;
    if (!window.confirm(`¿Eliminar “${item.title}” de Google Calendar?`)) return;
    setDeletingId(item.id);
    setError("");
    setErrorCode("");
    setSuccess("");
    try {
      const response = await fetch("/api/calendar/events/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: item.id, title: item.title }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        setErrorCode(data.code || "");
        throw new Error(data.error || "No se pudo eliminar el evento.");
      }
      setEvents((current) => current.filter((event) => event.id !== item.id));
      if (editingId === item.id) resetForm();
      setSuccess(`Evento “${item.title}” eliminado de Google Calendar.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo eliminar el evento.");
    } finally { setDeletingId(null); }
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className="status">● Google Calendar</div></div>
        <div className="headerActions"><a className="ghostButton navLink" href="/">Hablar</a><a className="ghostButton navLink" href="/briefing">Briefing</a><a className="ghostButton navLink" href="/dashboard">Panel</a></div>
      </header>

      <section className="panel calendarWorkspace">
        <div><div className="eyebrow">Agenda conectada</div><h1>Calendario</h1><p className="subtitle">Consulta, crea, mueve, edita y elimina compromisos sin salir de ZYRON.</p></div>

        {googleStatus?.connected && <div className={`healthBanner ${canWrite ? "healthy" : "degraded"}`}><div><strong>{canWrite ? "Google Calendar listo para gestionar eventos" : "Calendar conectado con permisos limitados"}</strong><span>{googleStatus.email || "Cuenta de Google conectada"}</span></div>{!canWrite && <a className="ghostButton navLink" href="/api/google/connect">Autorizar gestión</a>}</div>}
        {needsAuthorization && <div className="taskError">Falta autorizar el permiso para gestionar eventos. <a href="/api/google/connect">Conectar de nuevo con Google</a>.</div>}
        {error && !needsAuthorization && <div className="taskError">{error}</div>}
        {success && <div className="calendarSuccess">{success}</div>}

        <div className="calendarGrid">
          <section className="calendarBlock">
            <div className="calendarBlockHeader"><h2>Próximos 14 días</h2><button className="ghostButton" type="button" onClick={() => void loadEvents()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</button></div>
            {loading && <div className="taskEmpty">Consultando Google Calendar…</div>}
            {!loading && events.length === 0 && !error && <div className="taskEmpty">No hay eventos próximos.</div>}
            {!loading && events.map((item) => <div className="calendarEvent" key={item.id}><div className="calendarEventTime">{formatEvent(item)}</div><strong>{item.title}</strong>{item.location && <span>{item.location}</span>}<div className="headerActions">{item.htmlLink && <a className="ghostButton navLink" href={item.htmlLink} target="_blank" rel="noreferrer">Abrir</a>}<button className="ghostButton" type="button" onClick={() => beginEdit(item)} disabled={!canWrite}>Editar</button><button className="ghostButton" type="button" onClick={() => void removeEvent(item)} disabled={!canWrite || deletingId === item.id}>{deletingId === item.id ? "Eliminando…" : "Eliminar"}</button></div></div>)}
          </section>

          <section className="calendarBlock">
            <div className="calendarBlockHeader"><h2>{editingId ? "Editar evento" : "Crear evento"}</h2>{editingId && <button className="ghostButton" type="button" onClick={resetForm}>Cancelar edición</button>}</div>
            <form className="calendarForm" onSubmit={saveEvent}>
              <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="Dentista, reunión, entrenamiento…" /></label>
              <div className="calendarDates"><label>Inicio<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>Fin<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label></div>
              <label>Ubicación<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Opcional" /></label>
              <label>Notas<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder={editingId ? "Déjalo vacío para conservar las notas existentes" : "Opcional"} /></label>
              <button type="submit" disabled={saving || !title.trim() || !canWrite}>{saving ? "Guardando…" : canWrite ? (editingId ? "Guardar cambios" : "Crear en Google Calendar") : "Autoriza Google para gestionar"}</button>
            </form>
            {!canWrite && <p className="note">Pulsa “Autorizar gestión” una sola vez para conceder el nuevo permiso.</p>}
          </section>
        </div>
      </section>
    </main>
  );
}
