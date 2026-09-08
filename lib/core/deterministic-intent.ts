export type DeterministicCommand =
  | { type: "tasks_list" }
  | { type: "task_create"; query: string }
  | { type: "task_complete"; query: string }
  | { type: "daily_plan" }
  | { type: "briefing" }
  | { type: "activity" }
  | { type: "diagnostics" };

export function normalizeDeterministicText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^[¿¡\s]+/, "")
    .replace(/[?!.\s]+$/, "");
}

function cleanQuery(value: string) {
  return value.trim().replace(/[.!?]+$/, "").slice(0, 240);
}

function commandArgument(text: string, command: string) {
  return cleanQuery(text.replace(new RegExp(`^/${command}(?:@[a-z0-9_]+)?\\s*`, "i"), ""));
}

export function resolveDeterministicCommand(text: string): DeterministicCommand | null {
  const raw = text.trim();
  const clean = normalizeDeterministicText(raw);
  if (!clean || clean.length > 4_096) return null;

  if (/^\/tareas(?:@[a-z0-9_]+)?\s*$/i.test(raw)
    || /^(?:que|cuales) (?:tareas|cosas) (?:tengo )?pendientes$/i.test(clean)
    || /^lista (?:mis )?tareas(?: pendientes)?$/i.test(clean)) return { type: "tasks_list" };

  if (/^\/plan(?:@[a-z0-9_]+)?\s*$/i.test(raw)
    || /^(?:planifica|organiza) mi dia$/i.test(clean)
    || /^que (?:debo priorizar|priorizo) hoy$/i.test(clean)) return { type: "daily_plan" };

  if (/^\/briefing(?:@[a-z0-9_]+)?\s*$/i.test(raw)
    || /^(?:dame|prepara|hazme) (?:el |un )?briefing(?: del dia)?$/i.test(clean)
    || /^ponme al dia$/i.test(clean)) return { type: "briefing" };

  if (/^\/actividad(?:@[a-z0-9_]+)?\s*$/i.test(raw)
    || /^(?:que has hecho|ultimas acciones|muestrame tu actividad)$/i.test(clean)) return { type: "activity" };

  if (/^\/diagnostico(?:@[a-z0-9_]+)?\s*$/i.test(raw)
    || /^(?:diagnostico|estado) (?:de zyron|del sistema|del nucleo)$/i.test(clean)
    || /^funciona todo$/i.test(clean)) return { type: "diagnostics" };

  if (/^\/tarea(?:@[a-z0-9_]+)?(?:\s|$)/i.test(raw)) {
    return { type: "task_create", query: commandArgument(raw, "tarea") };
  }
  for (const pattern of [
    /^(?:apunta|apuntame)\s+(?:como tarea\s+)?(.+)$/i,
    /^(?:crea|anade)\s+(?:una\s+)?tarea(?:\s+para)?\s+(.+)$/i,
    /^recuerdame\s+(?:que\s+)?(.+)$/i,
  ]) {
    const query = cleanQuery(clean.match(pattern)?.[1] || "");
    if (query) return { type: "task_create", query };
  }

  if (/^\/completar(?:@[a-z0-9_]+)?(?:\s|$)/i.test(raw)) {
    return { type: "task_complete", query: commandArgument(raw, "completar") };
  }
  for (const pattern of [
    /^(?:completa|termina)\s+(?:la tarea\s+)?(.+)$/i,
    /^marca\s+(?:la tarea\s+)?(.+?)\s+como\s+(?:completada|hecha)$/i,
    /^he terminado\s+(.+)$/i,
  ]) {
    const query = cleanQuery(clean.match(pattern)?.[1] || "");
    if (query) return { type: "task_complete", query };
  }

  return null;
}
