"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type MemoryDocument = {
  id: string;
  title: string;
  version: string;
  source_type: string;
  updated_at: string;
};

type MemoryStatus = {
  stats: { documents: number; blocks: number; revisions: number; updatedAt: string | null };
  documents: MemoryDocument[];
};

type SearchBlock = {
  id: string;
  heading: string;
  section_path: string;
  content: string;
  score: number;
};

export default function MemoryPage() {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState("zyron-memory-master");
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchBlock[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      const data = (await response.json()) as MemoryStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se ha podido cargar la memoria");
      setStatus(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se ha podido cargar la memoria");
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function importDocument(event: FormEvent) {
    event.preventDefault();
    if (!file || importing) return;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      if (file.size > 1_500_000) throw new Error("El archivo supera el máximo de 1,5 MB");
      const markdown = await file.text();
      const response = await fetch("/api/memory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: documentId.trim() || "zyron-memory-master",
          title: file.name.replace(/\.(md|markdown|txt)$/i, ""),
          markdown,
          sourceType: "uploaded-markdown",
          metadata: { originalFileName: file.name },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        result?: { blockCount: number; version: string; unchanged: boolean };
      };
      if (!response.ok || !data.result) throw new Error(data.error || "No se ha podido importar");
      setMessage(data.result.unchanged
        ? `La memoria ya estaba actualizada: ${data.result.blockCount} bloques.`
        : `Memoria cargada: ${data.result.blockCount} bloques, versión ${data.result.version}.`);
      setFile(null);
      const input = document.getElementById("memory-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await loadStatus();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se ha podido importar la memoria");
    } finally {
      setImporting(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    if (!clean || searching) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/memory/search?q=${encodeURIComponent(clean)}&limit=8`, { cache: "no-store" });
      const data = (await response.json()) as { blocks?: SearchBlock[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se ha podido buscar");
      setResults(data.blocks ?? []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "No se ha podido buscar");
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div><div className="brand">ZYRON</div><div className="status">● Memoria privada</div></div>
        <a className="ghostButton navLink" href="/">Volver</a>
      </header>

      <section className="panel memoryPanel">
        <div className="eyebrow">Contexto independiente</div>
        <h1>Memoria</h1>
        <p className="subtitle">Información persistente y portátil, guardada en el núcleo privado y disponible para ZYRON y otros clientes autorizados.</p>

        <div className="memoryStats">
          <article><strong>{status?.stats.documents ?? "—"}</strong><span>documentos</span></article>
          <article><strong>{status?.stats.blocks ?? "—"}</strong><span>bloques activos</span></article>
          <article><strong>{status?.stats.revisions ?? "—"}</strong><span>versiones</span></article>
        </div>

        {error && <p className="taskError">{error}</p>}
        {message && <p className="memorySuccess">{message}</p>}

        <section className="memoryCard">
          <h2>Cargar documento maestro</h2>
          <p>Selecciona el archivo Markdown. Si vuelves a cargarlo, ZYRON actualizará los bloques y conservará la versión anterior.</p>
          <form className="memoryForm" onSubmit={importDocument}>
            <label htmlFor="memory-document-id">Identificador estable</label>
            <input id="memory-document-id" value={documentId} onChange={(event) => setDocumentId(event.target.value)} maxLength={120} />
            <label htmlFor="memory-file">Documento Markdown</label>
            <input id="memory-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <button type="submit" disabled={!file || importing}>{importing ? "Cargando…" : "Importar memoria"}</button>
          </form>
        </section>

        <section className="memoryCard">
          <div className="memoryCardHeader"><h2>Probar recuperación</h2><a className="ghostButton navLink" href="/api/memory/export">Exportar JSON</a></div>
          <p>Comprueba qué información encontrará ZYRON antes de preguntársela en el chat.</p>
          <form className="memorySearch" onSubmit={search}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej.: ¿A qué hora suelo llegar al trabajo?" />
            <button type="submit" disabled={!query.trim() || searching}>{searching ? "Buscando…" : "Buscar"}</button>
          </form>
          <div className="memoryResults" aria-live="polite">
            {results.map((block) => (
              <article key={block.id}>
                <strong>{block.heading}</strong>
                <span>{block.section_path}</span>
                <p>{block.content.length > 520 ? `${block.content.slice(0, 520)}…` : block.content}</p>
              </article>
            ))}
            {query && !searching && results.length === 0 && <div className="taskEmpty">No hay resultados para esta consulta.</div>}
          </div>
        </section>

        <section className="memoryCard">
          <h2>Fuentes cargadas</h2>
          {!status?.documents.length && <div className="taskEmpty">La memoria aún está vacía.</div>}
          {status?.documents.map((document) => (
            <div className="compactRow" key={document.id}>
              <span>◆</span>
              <div><strong>{document.title}</strong><small>{document.id} · v{document.version} · {new Date(document.updated_at).toLocaleString("es-ES")}</small></div>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}
