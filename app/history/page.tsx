"use client";
import { useEffect, useState } from "react";
import type { JournalEntry } from "../../lib/journal-policy";
import { flushJournal } from "../../lib/client/journal";

export default function HistoryPage() {
  const [entries,setEntries]=useState<JournalEntry[]>([]);
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("");
  const [editing,setEditing]=useState<JournalEntry|null>(null);
  const [text,setText]=useState("");
  async function load(before?:string, beforeId = "") {
    try {
      const response=await fetch(`/api/history?q=${encodeURIComponent(query)}${before?`&before=${encodeURIComponent(before)}&beforeId=${encodeURIComponent(beforeId)}`:""}`,{cache:"no-store"});
      const data=await response.json(); if(!response.ok) throw new Error(data.error);
      setEntries(data.entries);setStatus(data.entries.length?"":"No hay conversaciones en esta página.");
    } catch(e) { setStatus(e instanceof Error?e.message:"No se ha podido cargar"); }
  }
  useEffect(()=>{
    const listener = (e: Event) => setStatus((e as CustomEvent<string>).detail);
    window.addEventListener("zyron:history-status",listener);
    void load();
    return () => window.removeEventListener("zyron:history-status",listener);
  },[]);
  async function change(method:string,body:object) {
    try {
      const response=await fetch("/api/history",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setEditing(null);await load();setStatus("Operación completada.");
    }catch(e){setStatus(e instanceof Error?e.message:"No se ha completado");}
  }
  return <main className="shell"><header className="topbar"><span className="brand">ZYRON</span><a href="/">Volver al núcleo</a></header>
    <section className="memoryPanel"><h1>Historial compartido</h1>
      <p>Conversaciones de web, app y Telegram. Las preferencias y correcciones se recuperan como contexto; las respuestas de Zyron no se convierten en hechos confirmados. La voz se conserva como transcripción, no como grabación.</p>
      <p>El historial anterior de ChatGPT y los archivos externos necesitan importarse desde Memoria. Este panel no tiene acceso automático a ellos.</p>
      <a href="/memory">Memoria e importación de documentos</a>
      <form onSubmit={e=>{e.preventDefault();void load();}}><input aria-label="Buscar en conversaciones" value={query} onChange={e=>setQuery(e.target.value)}/><button>Buscar</button></form>
      <button onClick={()=>void change("POST",{migrateTelegram:true})}>Incorporar historial de Telegram conservado</button>
      <button onClick={()=>void flushJournal()}>Reintentar sincronización</button>
      <p role="status">{status}</p>
    </section>
    {entries.map(entry=><article key={entry.id} className="memoryPanel">
      <p>{entry.channel} · {entry.role==="user"?"Usted":"Zyron"} · {new Date(entry.occurredAt).toLocaleString("es-ES")}</p>
      {editing?.id===entry.id?<><textarea aria-label="Corregir conversación" value={text} maxLength={20000} onChange={e=>setText(e.target.value)}/><button onClick={()=>void change("PATCH",{id:entry.id,expectedContent:entry.content,content:text})}>Guardar corrección</button><button onClick={()=>setEditing(null)}>Cancelar</button></>:<><p style={{whiteSpace:"pre-wrap"}}>{entry.content}</p><button onClick={()=>{setEditing(entry);setText(entry.content);}}>Corregir</button><button onClick={()=>{if(window.confirm("¿Borrar este mensaje del historial compartido? No elimina copias externas ni recuerdos guardados por separado."))void change("DELETE",{id:entry.id});}}>Borrar</button></>}
    </article>)}
    {entries.length===100&&<button onClick={()=>void load(entries[entries.length-1].occurredAt, entries[entries.length-1].id)}>Conversaciones anteriores</button>}
  </main>;
}
