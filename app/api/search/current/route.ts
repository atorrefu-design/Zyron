import { NextResponse } from "next/server";
import { searchCurrentInformation } from "../../../../lib/current-search";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: string };
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: "Falta la consulta" }, { status: 400 });
    }

    const result = await searchCurrentInformation(query);

    return NextResponse.json({
      ok: true,
      reply: result.reply,
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
