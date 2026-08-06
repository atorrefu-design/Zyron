"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "No se pudo acceder");
        return;
      }

      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el núcleo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">ACCESO PRIVADO</p>
        <h1 id="login-title">ZYRON</h1>
        <p>Este núcleo pertenece exclusivamente a Aarón.</p>

        <form onSubmit={submit}>
          <label htmlFor="owner-key">Clave del propietario</label>
          <input
            id="owner-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoFocus
            required
          />
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? "Verificando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
