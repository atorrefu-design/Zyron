import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerSession } from "./lib/auth";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/native-login",
  "/api/memory/openapi",
  "/api/google/callback",
  "/api/push/dispatch",
  "/favicon.ico",
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isTimeChatMessage(value: string) {
  const clean = normalize(value).replace(/\s+/g, " ").trim();
  return /\b(que hora es|que hora tienes|dime la hora|hora actual|hora es ahora)\b/.test(clean);
}

function isMobilityChatMessage(value: string) {
  const clean = normalize(value);
  const explicitMobility = /\b(trafico|ruta|trayecto|cuanto tardo|cuanto tardare|hora de salir|hora tengo que salir|cuando tengo que salir|cuando debo salir|a que hora salgo|a que hora tengo que salir|llego a tiempo|llegare a tiempo|salida recomendada)\b/.test(clean);
  const commuteArrival = /\b(llego|llegare|llegaria)\b.*\b(trabajo|oficina|curro)\b/.test(clean);
  const timedDeparture = /\b(salgo|saldre|saldria|salir)\b.*\blas?\s+\d{1,2}(?:[:.]\d{2})?\b/.test(clean);
  const routineArrival = /\b(quiero|prefiero|necesito|fija|pon|cambia|actualiza|guarda)\b.*\b(llegar|llegada|hora)\b.*\b(trabajo|oficina|curro)\b/.test(clean)
    || /\b(mi hora habitual de llegada|mi hora de llegada)\b.*\b(trabajo|oficina|curro)\b/.test(clean);
  const routineAddress = /\b(mi\s+(?:trabajo|oficina|curro)\s+esta\s+en|direccion\s+de\s+mi\s+(?:trabajo|oficina|curro)|(?:cambia|actualiza|corrige|guarda)\s+(?:la\s+)?direccion\s+de\s+(?:mi\s+)?(?:trabajo|oficina|curro))\b/.test(clean);
  return explicitMobility || commuteArrival || timedDeparture || routineArrival || routineAddress;
}

async function chatRewrite(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/chat" || request.method !== "POST") return null;
  try {
    const body = (await request.clone().json()) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const message = [...(body.messages ?? [])]
      .reverse()
      .find((item) => item.role === "user" && typeof item.content === "string")
      ?.content;
    if (!message) return null;

    const url = request.nextUrl.clone();
    if (isTimeChatMessage(message)) {
      url.pathname = "/api/time";
      return NextResponse.rewrite(url);
    }
    if (isMobilityChatMessage(message)) {
      url.pathname = "/api/maps/chat";
      return NextResponse.rewrite(url);
    }
    return null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get("zyron_owner_session")?.value ?? null;
  const nativeToken = bearerToken(request);
  const [nativeAuthenticated, cookieAuthenticated] = await Promise.all([
    verifyOwnerSession(nativeToken),
    verifyOwnerSession(cookieToken),
  ]);
  const authenticated = nativeAuthenticated || cookieAuthenticated;

  if (authenticated) {
    const rewrite = await chatRewrite(request);
    return rewrite ?? NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|robots.txt|sitemap.xml|manifest.webmanifest|icon.svg|sw.js).*)"],
};
