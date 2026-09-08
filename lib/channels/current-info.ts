function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function directCurrentInfoQuery(text: string) {
  const clean = normalized(text);
  if (!clean || clean.length > 4_096) return null;
  const explicitSearch = /\b(?:consulta|consultame|busca|buscame|mira|revisa|comprueba|investiga|verifica)\b/.test(clean);
  const currentSource = /\b(?:web|internet|online|pagina|sitio|federacion|fcbq|noticias|actualidad|hoy|ahora|esta temporada)\b/.test(clean);
  return explicitSearch && currentSource ? text.trim().slice(0, 1_000) : null;
}
