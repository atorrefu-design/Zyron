import { NextResponse } from "next/server";
import { disableCommuteProfile, getCommuteProfile, saveCommuteProfile } from "../../../../lib/commute";

export const runtime = "nodejs";

type SaveRequest = {
  origin?: { latitude?: number; longitude?: number };
  destination?: string;
  arrivalTime?: string;
  bufferMinutes?: number;
  weekdays?: number[];
};

export async function GET() {
  try {
    const profile = await getCommuteProfile();
    return NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_COMMUTE_STATUS_ERROR", error);
    return NextResponse.json({ error: "commute_status_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveRequest;
    const latitude = body.origin?.latitude;
    const longitude = body.origin?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return NextResponse.json({ error: "commute_origin_required" }, { status: 400 });
    }
    const profile = await saveCommuteProfile({
      origin: { latitude, longitude },
      destination: body.destination || "",
      arrivalTime: body.arrivalTime || "",
      bufferMinutes: body.bufferMinutes,
      weekdays: body.weekdays,
    });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    console.error("ZYRON_COMMUTE_SAVE_ERROR", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "commute_save_failed" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    const profile = await disableCommuteProfile();
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    console.error("ZYRON_COMMUTE_DISABLE_ERROR", error);
    return NextResponse.json({ error: "commute_disable_failed" }, { status: 500 });
  }
}
