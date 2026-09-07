import type { MemoryBlock, MemoryMatch } from "../memory.ts";

const MAX_BLOCK_CONTENT = 3_000;

function compact(value: string) {
  return value.replace(/\s+$/gm, "").trim();
}

function renderBlock(block: MemoryBlock, index: number) {
  const path = block.section_path || block.heading;
  const content = compact(block.content);
  const safeContent = content.length > MAX_BLOCK_CONTENT
    ? `${content.slice(0, MAX_BLOCK_CONTENT).trimEnd()}…`
    : content;
  return `${index}. ${path}\n${safeContent}`;
}

export function directMemoryQuery(text: string) {
  const clean = text.trim().replace(/^¿\s*/, "");
  const patterns = [
    /^(?:que|qué)\s+recuerdas\s+(?:de|sobre)\s+(.+)$/i,
    /^(?:busca|consulta)\s+(?:en\s+)?(?:tu\s+)?memoria\s+(?:sobre\s+)?(.+)$/i,
    /^memoria\s*:\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    const query = match?.[1]?.replace(/[?!.]+$/, "").trim();
    if (query) return query.slice(0, 500);
  }
  return null;
}

export function renderMemorySearch(query: string, matches: MemoryMatch[]) {
  if (!matches.length) {
    return `No encuentro ningún recuerdo activo relacionado con «${query}». Esta búsqueda se ha hecho directamente en la memoria privada, sin usar IA.`;
  }
  const body = matches.map((block, index) => renderBlock(block, index + 1)).join("\n\n");
  return `Memoria directa · «${query}»\n\n${body}\n\n${matches.length} bloque${matches.length === 1 ? "" : "s"} recuperado${matches.length === 1 ? "" : "s"}. Sin IA.`;
}

export function renderMemoryPage(input: {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  blocks: MemoryBlock[];
}) {
  if (!input.total) return "La memoria privada de ZYRON todavía no contiene bloques activos.";
  const firstPosition = (input.page - 1) * input.pageSize;
  const body = input.blocks.map((block, index) => renderBlock(block, firstPosition + index + 1)).join("\n\n");
  const next = input.page < input.totalPages ? ` Para continuar: /memoria_toda ${input.page + 1}` : " Has llegado al final.";
  return `Memoria completa · página ${input.page}/${input.totalPages} · ${input.total} bloques\n\n${body}\n\nLectura directa, sin IA.${next}`;
}
