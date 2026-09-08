import OpenAI from "openai";

export type CurrentSearchResult = {
  reply: string;
  model: string;
};

export async function searchCurrentInformation(query: string): Promise<CurrentSearchResult> {
  const cleanQuery = query.trim().slice(0, 1_000);
  if (!cleanQuery) throw new Error("current_search_query_required");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada");
  const model = process.env.OPENAI_SEARCH_MODEL || "gpt-5-mini";
  const response = await new OpenAI({ apiKey }).responses.create({
    model,
    tools: [{ type: "web_search" }],
    instructions: [
      "Responde como el núcleo único de ZYRON.",
      "Verifica la consulta con búsqueda web y prioriza fuentes oficiales.",
      "No inventes resultados, fechas, marcadores ni hechos actuales.",
      "Da primero la respuesta concreta en castellano de España.",
      "Incluye enlaces útiles cuando estén disponibles.",
    ].join("\n"),
    input: cleanQuery,
    store: false,
  }, { signal: AbortSignal.timeout(35_000) });
  const reply = response.output_text?.trim();
  if (!reply) throw new Error("current_search_empty_response");
  return { reply, model };
}
