import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: string };
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: "Falta la consulta" }, { status: 400 });
    }

    const openai = getOpenAI();
    if (!openai) {
      return NextResponse.json({ error: "OPENAI_API_KEY no está configurada" }, { status: 503 });
    }

    const response = await openai.responses.create({
      model: process.env.OPENAI_SEARCH_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
      tools: [{ type: "web_search" }],
      instructions: [
        "Responde como ZYRON.",
        "La consulta requiere información vigente: usa búsqueda web antes de responder.",
        "Da primero la respuesta concreta y útil; no expliques qué herramienta has usado.",
        "Si hay una fuente oficial disponible, priorízala.",
        "No inventes resultados, fechas, marcadores ni hechos actuales.",
        "Responde en castellano de España y de forma breve salvo que el usuario pida detalle.",
      ].join("\n"),
      input: query,
      store: false,
    });

    const reply = response.output_text?.trim();
    if (!reply) {
      return NextResponse.json({ error: "No se ha obtenido una respuesta útil" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      reply,
      action: "current_info_searched",
      tool: "web_search",
    });
  } catch (error) {
    console.error("ZYRON_CURRENT_SEARCH_ERROR", error);
    return NextResponse.json(
      { error: "No he podido consultar información actual ahora mismo." },
      { status: 500 },
    );
  }
}
