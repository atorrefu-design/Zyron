import type { MemoryBlock, MemoryMatch } from "../memory.ts";
import type { ChannelMessage } from "./store.ts";

const MAX_BLOCK_CONTENT = 3_000;

function compact(value: string) {
  return value.replace(/\s+$/gm, "").trim();
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ/_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFact(value: string) {
  return value
    .replace(/^\[Nota de voz transcrita\]\s*/i, "")
    .replace(/^(?:buenos d[ií]as|buenas tardes|buenas noches|hola)(?:\s+zyron)?[,:;.!\s-]*/i, "")
    .trim()
    .replace(/[.!?]+$/, "")
    .slice(0, 2_000);
}

function isMemoryConfirmation(text: string) {
  const clean = normalized(text);
  return /^(?:a|(?:si )?(?:guarda(?:lo)?(?: en)? (?:(?:tu|la) )?memoria|guardalo|hazlo|confirmo|intentalo de nuevo|intenta de nuevo|reintentalo|reintenta))$/.test(clean);
}

function explicitMemoryFact(text: string) {
  const clean = text.trim();
  const patterns = [
    /^\/guardar_memoria(?:@[a-z0-9_]+)?\s+(.+)$/i,
    /^(?:recuerda|memoriza)\s+(?:que\s+)?(.+)$/i,
    /^guarda\s+(?:en\s+)?(?:(?:tu|la)\s+)?memoria\s+(?:que\s+)?(.+)$/i,
    /^guarda\s+(.+?)\s+en\s+(?:(?:tu|la)\s+)?memoria$/i,
  ];
  for (const pattern of patterns) {
    const fact = clean.match(pattern)?.[1];
    if (fact && !/^memoria$/i.test(fact.trim())) return cleanFact(fact);
  }
  return null;
}

function hasMemoryConfirmationContext(history: ChannelMessage[]): boolean {
  const lastAssistant = history.findLastIndex((message) => message.role === "assistant");
  if (lastAssistant < 0) return false;
  // A later topic or user instruction invalidates an older memory proposal.
  if (history.slice(lastAssistant + 1).some((message) => message.role === "user" && !isMemoryConfirmation(message.content))) return false;
  const content = normalized(history[lastAssistant].content);
  if (/\bmemoria\b/.test(content) && /\b(?:guarda|guarde|guardado|guardar|fallo|error)\b/.test(content)) return true;
  if (!/\b(?:reintenta|intenta|intento|fallo|error|api)\b/.test(content)) return false;
  const previousUser = history.slice(0, lastAssistant).findLastIndex((message) => message.role === "user");
  return previousUser >= 0 && isMemoryConfirmation(history[previousUser].content)
    && hasMemoryConfirmationContext(history.slice(0, previousUser));
}

export function looksLikeMemoryWriteRequest(text: string) {
  return Boolean(explicitMemoryFact(text) || isMemoryConfirmation(text));
}

export function resolveMemoryWriteRequest(text: string, history: ChannelMessage[]) {
  const explicit = explicitMemoryFact(text);
  if (explicit) return { fact: explicit, source: "explicit" as const };
  if (!isMemoryConfirmation(text)) return null;
  if (!hasMemoryConfirmationContext(history)) return null;

  const lastMemoryAssistantIndex = history.findLastIndex((message) =>
    message.role === "assistant" && /memoria|recordar|guardad|guardarlo/i.test(message.content),
  );
  if (lastMemoryAssistantIndex < 0) return null;

  for (let index = lastMemoryAssistantIndex - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== "user") continue;
    const priorExplicit = explicitMemoryFact(message.content);
    if (priorExplicit) return { fact: priorExplicit, source: "confirmed_previous" as const };
    if (isMemoryConfirmation(message.content) || message.content.trim().startsWith("/")) continue;
    const fact = cleanFact(message.content);
    if (fact) return { fact, source: "confirmed_previous" as const };
  }
  return null;
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
