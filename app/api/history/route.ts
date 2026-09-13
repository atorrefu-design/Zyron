import { appendJournal, deleteJournal, importRetainedTelegramHistory, listJournal, updateJournal } from "../../../lib/journal";
import { validJournalEntry } from "../../../lib/journal-policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const before = url.searchParams.get("before") || undefined;
    if (before && !Number.isFinite(Date.parse(before))) return Response.json({error:"Fecha inválida"},{status:400});
    await importRetainedTelegramHistory();
    const entries = await listJournal((url.searchParams.get("q") || "").slice(0,500),before,(url.searchParams.get("beforeId") || "").slice(0,180));
    return Response.json({entries},{headers:{"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"El historial no está disponible."},{status:503}); }
}
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 1100000) return Response.json({error:"Lote demasiado grande"},{status:413});
    const body = JSON.parse(raw);
    if (body.migrateTelegram === true) return Response.json({ok:true,imported:await importRetainedTelegramHistory()});
    if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 50 || !body.entries.every(validJournalEntry)) return Response.json({error:"Entradas inválidas"},{status:400});
    return Response.json({ok:true,inserted:await appendJournal(body.entries)});
  } catch { return Response.json({error:"No se ha guardado el historial. Reintente la sincronización."},{status:503}); }
}
export async function PATCH(request: Request) {
  try {
    const b = await request.json();
    if (typeof b.id!=="string" || typeof b.expectedContent!=="string" || typeof b.content!=="string" || !b.content.trim() || b.content.length>20000) return Response.json({error:"Edición inválida"},{status:400});
    return await updateJournal(b.id,b.expectedContent,b.content.trim()) ? Response.json({ok:true}) : Response.json({error:"El texto ha cambiado. Recargue el historial."},{status:409});
  } catch { return Response.json({error:"No se ha actualizado"},{status:503}); }
}
export async function DELETE(request: Request) {
  try {
    const {id} = await request.json();
    if (typeof id!=="string" || id.length>180) return Response.json({error:"Identificador inválido"},{status:400});
    return Response.json({ok:await deleteJournal(id)});
  } catch { return Response.json({error:"No se ha borrado"},{status:503}); }
}
