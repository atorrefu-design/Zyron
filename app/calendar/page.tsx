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

type EventsResponse = {
  events?: CalendarEvent[];
  error?: string;
};

function localInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatEvent(event: CalendarEvent) {
  if (event.allDay) {
    return new Date(`${event.start}T12:00:00`).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
  }
  return new Date(event.start).toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CalendarPage() {
  const initialStart = new Date(Date.now() + 60 * 60 * 1000);
  initialStart.setMinutes(0, 0, 0);
  const initialEnd = new Date(initialStart.getTime() + 60 * 60 * 1000);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(localInputValue(initialStart));
  const [end, setEnd] = useState(localInputValue(initialEnd));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  async function loadEvents() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/calendar/events?days=14&limit=30", { cache: "no-store" });
      const data = (await response.json()) as EventsResponse;
      if (!response.ok) throw new Error(data.error || "No he podido leer Google Calendar.");
      setEvents(data.events || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No he podido leer Google Calendar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/calendar/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          location: location || null,
          description: description || null,
          timeZone: "Europe/Madrid",
        }),
      });
      const data = (await response.json()) as { error?: string; event?: CalendarEvent };
      if (!response.ok) throw new Error(data.error || "No se pudo crear el evento.");
      setSuccess(`Evento “${data.event?.title || title}” creado en Google Calendar.`);
      setTitle("");
      setLocation("");
      setDescription("");
      await loadEvents();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear el evento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className="status">● Google Calendar</div></div>
        <div className="headerActions">
          <a className="ghostButton navLink" href="/">Hablar</a>
          <a className="ghostButton navLink" href="/briefing">Briefing</a>
          <a className="ghostButton navLink" href="/dashboard">Panel</a>
        </div>
      </header>

      <section className="panel calendarWorkspace">
        <div><div className="eyebrow">Agenda conectada</div><h1>Calendario</h1><p className="subtitle">Consulta tus próximos eventos y crea nuevos compromisos sin salir de ZYRON.</p></div>

        {error && <div className="taskError">{error}</div>}
        {success && <div className="calendarSuccess">{success}</div>}

        <div className="calendarGrid">
          <section className="calendarBlock">
            <div className="calendarBlockHeader"><h2>Próximos 14 días</h2><button className="ghostButton" type="button" onClick={() => void loadEvents()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</button></div>
            {loading && <div className="taskEmpty">Consultando Google Calendar…</div>}
            {!loading && events.length === 0 && <div className="taskEmpty">No hay eventos próximos.</div>}
            {!loading && events.map((item) => (
              <a className="calendarEvent" href={item.htmlLink || undefined} target={item.htmlLink ? "_blank" : undefined} rel="noreferrer" key={item.id}>
                <div className="calendarEventTime">{formatEvent(item)}</div>
                <strong>{item.title}</strong>
                {item.location && <span>{item.location}</span>}
              </a>
            ))}
          </section>

          <section className="calendarBlock">
            <h2>Crear evento</h2>
            <form className="calendarForm" onSubmit={createEvent}>
              <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="Dentista, reunión, entrenamiento…" /></label>
              <div className="calendarDates">
                <label>Inicio<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
                <label>Fin<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
              </div>
              <label>Ubicación<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Opcional" /></label>
              <label>Notas<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Opcional" /></label>
              <button type="submit" disabled={saving || !title.trim()}>{saving ? "Creando…" : "Crear en Google Calendar"}</button>
            </form>
            <p className="note">La primera creación puede requerir volver a autorizar Google con permiso para gestionar eventos.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
