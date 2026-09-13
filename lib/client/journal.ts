import type { JournalEntry } from "../journal-policy";
const KEY = "zyron.pending-history.v1";
let flushing = false;
function pending(): JournalEntry[] {
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}
function notify(message: string) {
  window.dispatchEvent(new CustomEvent("zyron:history-status", {detail:message}));
}
export function queueJournal(role: JournalEntry["role"], content: string, id = crypto.randomUUID()) {
  try {
    const entries = pending();
    const eventId = `web:${id}:${role}`;
    if (!entries.some(e => e.id===eventId)) entries.push({id:eventId,channel:"web",role,content:content.slice(0,20000),occurredAt:new Date().toISOString()});
    localStorage.setItem(KEY,JSON.stringify(entries));
    notify(`${entries.length} mensajes pendientes de sincronizar.`);
    void flushJournal();
  } catch { notify("No se ha podido conservar este mensaje en el dispositivo. Revise el almacenamiento del navegador."); }
}
export async function flushJournal() {
  if (flushing) return;
  flushing = true;
  try {
    while (pending().length) {
      const batch = pending().slice(0,25);
      const response = await fetch("/api/history",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:batch}),signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error("sync_failed");
      const ids = new Set(batch.map(e=>e.id));
      localStorage.setItem(KEY,JSON.stringify(pending().filter(e=>!ids.has(e.id))));
    }
    notify("Historial sincronizado con el núcleo.");
  } catch { notify("Historial pendiente: se conserva en este navegador. Pulse Reintentar sincronización o vuelva a conectar."); }
  finally { flushing = false; }
}
