import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const DEFAULT_DOCUMENT_ID = "zyron-memory-master";
const MANUAL_DOCUMENT_ID = "zyron-manual-memory";
const MAX_IMPORTED_MARKDOWN_LENGTH = 1_500_000;

export type MemoryDocument = {
  id: string;
  title: string;
  version: string;
  source_type: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryBlock = {
  id: string;
  document_id: string;
  heading: string;
  section_path: string;
  content: string;
  position: number;
  priority: number;
  always_include: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryMatch = MemoryBlock & { score: number };

export type MemoryImportInput = {
  documentId?: string;
  title?: string;
  version?: string;
  markdown: string;
  sourceType?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryImportResult = {
  documentId: string;
  title: string;
  version: string;
  contentHash: string;
  blockCount: number;
  unchanged: boolean;
};

type ParsedMemoryBlock = {
  id: string;
  heading: string;
  sectionPath: string;
  content: string;
  position: number;
  priority: number;
  alwaysInclude: boolean;
  metadata: Record<string, unknown>;
};

function databaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL o POSTGRES_URL no está configurada");
  return url;
}

function sql() {
  return neon(databaseUrl());
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 90) || "bloque";
}

function cleanDocumentId(value: string) {
  const clean = slugify(value).slice(0, 120);
  return clean || DEFAULT_DOCUMENT_ID;
}

function contentHash(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function parseFrontmatter(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { metadata: {} as Record<string, string>, bodyStart: 0 };
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (end < 0) return { metadata: {} as Record<string, string>, bodyStart: 0 };

  const metadata: Record<string, string> = {};
  for (const line of lines.slice(1, end + 1)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { metadata, bodyStart: end + 2 };
}

function blockPolicy(heading: string, sectionPath: string) {
  const label = normalize(`${sectionPath} ${heading}`);
  const alwaysInclude = /(^| )(1 proposito|2 reglas de interpretacion|3 1 definicion confirmada|6 1 voz y lenguaje|6 2 forma de trabajar|6 3 proactividad)( |$)/.test(label);
  let priority = alwaysInclude ? 100 : 50;
  if (/perfil de aaron|personas relaciones|rutina laboral|contactos prioritarios/.test(label)) priority = Math.max(priority, 85);
  if (/proyecto maninter|proyecto vivienda|proyecto baloncesto|proyecto fc barcelona|proyecto marvel/.test(label)) priority = Math.max(priority, 70);
  if (/arquitectura|estado tecnico|prioridad actual|plan de continuacion/.test(label)) priority = Math.max(priority, 60);
  return { alwaysInclude, priority };
}

export function parseMemoryMarkdown(markdown: string, requestedDocumentId = DEFAULT_DOCUMENT_ID) {
  const documentId = cleanDocumentId(requestedDocumentId);
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const { metadata: frontmatter, bodyStart } = parseFrontmatter(markdown);
  const stack: Record<number, string> = {};
  const blocks: ParsedMemoryBlock[] = [];
  let current: { heading: string; level: number; lines: string[]; position: number } | null = null;

  function finishCurrent() {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (!content) {
      current = null;
      return;
    }
    const sectionPath = Object.keys(stack)
      .map(Number)
      .filter((level) => level <= current!.level)
      .sort((a, b) => a - b)
      .map((level) => stack[level])
      .join(" > ");
    const policy = blockPolicy(current.heading, sectionPath);
    blocks.push({
      id: `${documentId}:${String(current.position).padStart(3, "0")}-${slugify(current.heading)}`,
      heading: current.heading,
      sectionPath,
      content,
      position: current.position,
      priority: policy.priority,
      alwaysInclude: policy.alwaysInclude,
      metadata: { headingLevel: current.level },
    });
    current = null;
  }

  let position = 0;
  for (const line of lines.slice(bodyStart)) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (!headingMatch) {
      if (current) current.lines.push(line);
      continue;
    }

    const level = headingMatch[1].length;
    const heading = headingMatch[2].trim();
    finishCurrent();
    stack[level] = heading;
    for (const stackedLevel of Object.keys(stack).map(Number)) {
      if (stackedLevel > level) delete stack[stackedLevel];
    }

    if (level === 1) {
      continue;
    }

    position += 1;
    current = { heading, level, lines: [], position };
  }
  finishCurrent();

  return { documentId, frontmatter, blocks };
}

let memoryTablesPromise: Promise<void> | null = null;

async function createMemoryTables() {
  const query = sql();
  await query`
    CREATE TABLE IF NOT EXISTS zyron_memory_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      source_type TEXT NOT NULL DEFAULT 'markdown',
      markdown TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await query`
    CREATE TABLE IF NOT EXISTS zyron_memory_revisions (
      id BIGSERIAL PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES zyron_memory_documents(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      markdown TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id, content_hash)
    )
  `;
  await query`
    CREATE TABLE IF NOT EXISTS zyron_memory_blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES zyron_memory_documents(id) ON DELETE CASCADE,
      heading TEXT NOT NULL,
      section_path TEXT NOT NULL,
      content TEXT NOT NULL,
      position BIGINT NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 50,
      always_include BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await query`CREATE INDEX IF NOT EXISTS zyron_memory_blocks_document_idx ON zyron_memory_blocks(document_id, position)`;
  await query`CREATE INDEX IF NOT EXISTS zyron_memory_blocks_active_idx ON zyron_memory_blocks(active, always_include, priority DESC)`;
}

export function ensureMemoryTables() {
  if (!memoryTablesPromise) {
    memoryTablesPromise = createMemoryTables().catch((error) => {
      memoryTablesPromise = null;
      throw error;
    });
  }
  return memoryTablesPromise;
}

export async function importMemoryDocument(input: MemoryImportInput): Promise<MemoryImportResult> {
  const markdown = input.markdown?.trim();
  if (!markdown) throw new Error("El documento de memoria está vacío");
  if (markdown.length > MAX_IMPORTED_MARKDOWN_LENGTH) throw new Error("El documento de memoria supera el tamaño permitido");

  const requestedId = input.documentId || DEFAULT_DOCUMENT_ID;
  const parsed = parseMemoryMarkdown(markdown, requestedId);
  if (!parsed.blocks.length) throw new Error("No se han encontrado secciones Markdown importables");

  const documentId = parsed.documentId;
  const inferredTitle = parsed.frontmatter.assistant_current_name
    ? `Memoria maestra de ${parsed.frontmatter.assistant_current_name}`
    : "Memoria maestra de ZYRON";
  const title = input.title?.trim() || inferredTitle;
  const version = input.version?.trim() || parsed.frontmatter.version || "1.0";
  const hash = contentHash(markdown);
  const metadata = {
    ...parsed.frontmatter,
    ...(input.metadata ?? {}),
    importedBy: "zyron-memory-api",
  };

  await ensureMemoryTables();
  const query = sql();
  const existing = await query`
    SELECT content_hash
    FROM zyron_memory_documents
    WHERE id = ${documentId}
    LIMIT 1
  `;
  const unchanged = existing[0]?.content_hash === hash;

  await query`
    INSERT INTO zyron_memory_documents (id, title, version, source_type, markdown, content_hash, metadata)
    VALUES (${documentId}, ${title}, ${version}, ${input.sourceType || "markdown"}, ${markdown}, ${hash}, ${JSON.stringify(metadata)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      version = EXCLUDED.version,
      source_type = EXCLUDED.source_type,
      markdown = EXCLUDED.markdown,
      content_hash = EXCLUDED.content_hash,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `;
  await query`
    INSERT INTO zyron_memory_revisions (document_id, version, markdown, content_hash, metadata)
    VALUES (${documentId}, ${version}, ${markdown}, ${hash}, ${JSON.stringify(metadata)}::jsonb)
    ON CONFLICT (document_id, content_hash) DO NOTHING
  `;

  for (const block of parsed.blocks) {
    await query`
      INSERT INTO zyron_memory_blocks (
        id, document_id, heading, section_path, content, position, priority, always_include, active, metadata
      ) VALUES (
        ${block.id}, ${documentId}, ${block.heading}, ${block.sectionPath}, ${block.content},
        ${block.position}, ${block.priority}, ${block.alwaysInclude}, TRUE, ${JSON.stringify(block.metadata)}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        heading = EXCLUDED.heading,
        section_path = EXCLUDED.section_path,
        content = EXCLUDED.content,
        position = EXCLUDED.position,
        priority = EXCLUDED.priority,
        always_include = EXCLUDED.always_include,
        active = TRUE,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `;
  }

  const keptIds = parsed.blocks.map((block) => block.id);
  await query`
    DELETE FROM zyron_memory_blocks
    WHERE document_id = ${documentId}
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${JSON.stringify(keptIds)}::jsonb) AS kept(id)
        WHERE kept.id = zyron_memory_blocks.id
      )
  `;

  return {
    documentId,
    title,
    version,
    contentHash: hash,
    blockCount: parsed.blocks.length,
    unchanged,
  };
}

export async function listMemoryDocuments(): Promise<MemoryDocument[]> {
  await ensureMemoryTables();
  const rows = await sql()`
    SELECT id, title, version, source_type, content_hash, metadata, created_at, updated_at
    FROM zyron_memory_documents
    ORDER BY updated_at DESC
  `;
  return rows as MemoryDocument[];
}

export async function getMemoryStats() {
  await ensureMemoryTables();
  const rows = await sql()`
    SELECT
      (SELECT COUNT(*)::int FROM zyron_memory_documents) AS documents,
      (SELECT COUNT(*)::int FROM zyron_memory_blocks WHERE active) AS blocks,
      (SELECT COUNT(*)::int FROM zyron_memory_revisions) AS revisions,
      (SELECT MAX(updated_at) FROM zyron_memory_documents) AS updated_at
  `;
  const row = rows[0] as { documents?: number; blocks?: number; revisions?: number; updated_at?: string | null } | undefined;
  return {
    documents: Number(row?.documents ?? 0),
    blocks: Number(row?.blocks ?? 0),
    revisions: Number(row?.revisions ?? 0),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function listMemoryBlocksPage(page = 1, pageSize = 5) {
  await ensureMemoryTables();
  const safePageSize = Math.max(1, Math.min(Math.floor(pageSize) || 5, 10));
  const countRows = await sql()`
    SELECT COUNT(*)::int AS total
    FROM zyron_memory_blocks
    WHERE active
  `;
  const total = Number(countRows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(Math.floor(page) || 1, totalPages));
  const offset = (safePage - 1) * safePageSize;
  const rows = await sql()`
    SELECT id, document_id, heading, section_path, content, position, priority, always_include, metadata, created_at, updated_at
    FROM zyron_memory_blocks
    WHERE active
    ORDER BY document_id, position, created_at
    LIMIT ${safePageSize}
    OFFSET ${offset}
  `;
  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    blocks: rows as MemoryBlock[],
  };
}

async function activeMemoryBlocks(): Promise<MemoryBlock[]> {
  await ensureMemoryTables();
  const rows = await sql()`
    SELECT id, document_id, heading, section_path, content, position, priority, always_include, metadata, created_at, updated_at
    FROM zyron_memory_blocks
    WHERE active
    ORDER BY always_include DESC, priority DESC, position ASC, updated_at DESC
    LIMIT 500
  `;
  return rows as MemoryBlock[];
}

const STOP_WORDS = new Set([
  "a", "al", "algo", "como", "con", "cual", "cuales", "cuando", "de", "del", "dime", "donde", "el", "ella", "en",
  "es", "esa", "ese", "esto", "hay", "la", "las", "lo", "los", "me", "mi", "mis", "para", "por", "que", "quien",
  "se", "sobre", "su", "sus", "te", "tengo", "tiene", "tu", "tus", "un", "una", "y", "yo",
]);

function queryTerms(query: string) {
  const clean = normalize(query);
  const terms = new Set(clean.split(" ").filter((term) => term.length >= 3 && !STOP_WORDS.has(term)));
  const expansions: Array<[RegExp, string[]]> = [
    [/^(?:que|cuanto) (?:sabes|recuerdas) de mi$|^me conoces$/, ["perfil", "aaron", "rutina", "familia", "trabajo", "preferencias"]],
    [/hora|horario|rutina|oficina|trabajo/, ["rutina", "laboral", "horario", "trabajo", "oficina"]],
    [/pareja|madre|mama|hermana|familia|contacto/, ["personas", "relaciones", "contactos", "familia"]],
    [/casa|vivienda|parcela|terreno|hipoteca/, ["vivienda", "parcela", "terreno", "financiacion"]],
    [/basket|basquet|baloncesto|brafa|jugador|defensa/, ["baloncesto", "brafa", "jugadores", "defensa"]],
    [/barca|barcelona|fcb|futbol|flick|plantilla/, ["barcelona", "plantilla", "flick", "futbol"]],
    [/marvel|spider|spiderman|ucm|comics/, ["marvel", "spiderman", "ucm"]],
    [/maninter|operario|mantenimiento|pci|baja tension/, ["maninter", "operarios", "mantenimiento", "pci", "bt"]],
    [/tono|estilo|respuesta|respond|hablar/, ["estilo", "respuesta", "voz", "lenguaje"]],
    [/zyron|asistente|arquitectura|wake word|memoria/, ["zyron", "asistente", "arquitectura", "memoria"]],
  ];
  for (const [pattern, values] of expansions) {
    if (pattern.test(clean)) values.forEach((value) => terms.add(value));
  }
  return { clean, terms: [...terms] };
}

function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while ((from = haystack.indexOf(needle, from)) >= 0) {
    count += 1;
    from += needle.length;
  }
  return count;
}

function scoreBlock(block: MemoryBlock, cleanQuery: string, terms: string[]) {
  const heading = normalize(block.heading);
  const path = normalize(block.section_path);
  const content = normalize(block.content);
  let score = 0;

  if (cleanQuery.length >= 6 && content.includes(cleanQuery)) score += 80;
  for (const term of terms) {
    if (heading.includes(term)) score += 14;
    if (path.includes(term)) score += 9;
    score += Math.min(occurrences(content, term), 4) * 3;
  }
  if (score > 0 && block.document_id === MANUAL_DOCUMENT_ID) score += 4;
  if (score > 0) score += Math.max(0, block.priority - 50) / 10;
  const isProcessBlock = /orden de trabajo|criterio de exito|registro de cambios/.test(`${heading} ${path}`);
  const asksForProcess = /plan|estado|punto|pendiente|continuacion|cambios/.test(cleanQuery);
  if (isProcessBlock && !asksForProcess) score -= 120;
  return score;
}

export async function searchMemoryBlocks(
  query: string,
  options: { limit?: number; includeAlways?: boolean } = {},
): Promise<MemoryMatch[]> {
  const blocks = await activeMemoryBlocks();
  return rankMemoryBlocks(blocks, query, options);
}

export function rankMemoryBlocks(
  blocks: MemoryBlock[],
  query: string,
  options: { limit?: number; includeAlways?: boolean } = {},
): MemoryMatch[] {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 30));
  const includeAlways = options.includeAlways ?? true;
  const { clean, terms } = queryTerms(query);
  const always = includeAlways
    ? blocks.filter((block) => block.always_include).map((block) => ({ ...block, score: 1_000 }))
    : [];
  const alwaysIds = new Set(always.map((block) => block.id));
  const ranked = blocks
    .filter((block) => !alwaysIds.has(block.id))
    .map((block) => ({ ...block, score: scoreBlock(block, clean, terms) }))
    .filter((block) => block.score > 0)
    .sort((a, b) => b.score - a.score || b.priority - a.priority || a.position - b.position)
    .slice(0, limit);
  return [...always, ...ranked];
}

export async function buildMemoryContext(query: string, maxCharacters = 20_000) {
  const matches = await searchMemoryBlocks(query, { limit: 10, includeAlways: true });
  const selected: MemoryMatch[] = [];
  const parts: string[] = [];
  let usedCharacters = 0;

  for (const block of matches) {
    const rendered = `[${block.section_path || block.heading}]\n${block.content}`;
    if (parts.length && usedCharacters + rendered.length > maxCharacters) continue;
    parts.push(rendered);
    selected.push(block);
    usedCharacters += rendered.length;
  }

  return {
    context: parts.length ? parts.join("\n\n---\n\n") : "No hay bloques de memoria local relevantes para este mensaje.",
    blocks: selected,
  };
}

export async function recordManualMemoryFact(content: string, metadata: Record<string, unknown> = {}) {
  const clean = content.trim();
  if (!clean) throw new Error("La memoria está vacía");
  if (clean.length > 8_000) throw new Error("La memoria es demasiado larga");
  await ensureMemoryTables();

  const query = sql();
  const documentContent = "Memorias explícitas guardadas por Aarón desde ZYRON.";
  const hash = contentHash(documentContent);
  await query`
    INSERT INTO zyron_memory_documents (id, title, version, source_type, markdown, content_hash, metadata)
    VALUES (${MANUAL_DOCUMENT_ID}, ${"Memorias explícitas"}, ${"1.0"}, ${"manual"}, ${documentContent}, ${hash}, ${JSON.stringify({ private: true })}::jsonb)
    ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
  `;

  const id = `${MANUAL_DOCUMENT_ID}:${randomUUID()}`;
  const rows = await query`
    INSERT INTO zyron_memory_blocks (
      id, document_id, heading, section_path, content, position, priority, always_include, active, metadata
    ) VALUES (
      ${id}, ${MANUAL_DOCUMENT_ID}, ${"Memoria explícita"}, ${"Memoria manual"}, ${clean},
      ${Math.floor(Date.now() / 1000)}, 90, FALSE, TRUE, ${JSON.stringify({ source: "explicit-user-command", ...metadata })}::jsonb
    )
    RETURNING id, document_id, heading, section_path, content, position, priority, always_include, metadata, created_at, updated_at
  `;
  return rows[0] as MemoryBlock;
}

export async function deleteMemoryBlock(id: string) {
  await ensureMemoryTables();
  const rows = await sql()`
    DELETE FROM zyron_memory_blocks
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function exportMemorySnapshot() {
  await ensureMemoryTables();
  const query = sql();
  const [documents, blocks] = await Promise.all([
    query`
      SELECT id, title, version, source_type, markdown, content_hash, metadata, created_at, updated_at
      FROM zyron_memory_documents
      ORDER BY updated_at DESC
    `,
    query`
      SELECT id, document_id, heading, section_path, content, position, priority, always_include, active, metadata, created_at, updated_at
      FROM zyron_memory_blocks
      ORDER BY document_id, position, created_at
    `,
  ]);
  return {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    owner: "aaron",
    documents,
    blocks,
  };
}
