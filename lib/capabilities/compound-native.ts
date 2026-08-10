import { decideAction } from "./action-policy";
import { buildNativePayload, type NativePayload } from "./native-payload";
import { nativeResultType, type NativeResultType } from "./result-types";
import { resolveCapabilityRequest } from "./resolve";

export type NativeSequenceStep = {
  action: string;
  capabilityId: string;
  input: string;
  payload: NativePayload;
  resultType: NativeResultType;
};

function stripWakeWord(value: string) {
  return value.replace(/^\s*(zyron|zayron)[,\s:-]*/i, "").trim();
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitSequentialClauses(input: string): string[] {
  const clean = stripWakeWord(input);
  if (/\b(si|cuando|después de que|despues de que)\b/i.test(clean)) return [];

  return clean
    .split(/\s+(?:y\s+luego|y\s+despu[eé]s|luego|despu[eé]s|y)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function explicitReferencedType(input: string): NativeResultType | null {
  const text = normalize(input);
  if (["ubicacion", "donde estoy", "coordenadas"].some((token) => text.includes(token))) return "location";
  if (["grabacion", "audio", "archivo", "fichero"].some((token) => text.includes(token))) return "file";
  if (["notificacion", "aviso"].some((token) => text.includes(token))) return "notification";
  if (["enlace", "url", "link"].some((token) => text.includes(token))) return "url";
  if (["texto", "mensaje", "resultado"].some((token) => text.includes(token))) return "text";
  return null;
}

function refersToPriorResult(input: string) {
  const text = normalize(input);
  return [
    "eso",
    "ese resultado",
    "el resultado",
    "esa ubicacion",
    "la ubicacion",
    "mi ubicacion",
    "ubicacion actual",
    "ese archivo",
    "el archivo",
    "esa grabacion",
    "la grabacion",
    "ese audio",
    "el audio",
    "ese enlace",
    "el enlace",
    "mandaselo",
    "mandasela",
    "enviaselo",
    "enviasela",
    "compartelo",
    "compartela",
  ].some((token) => text.includes(token));
}

function bestTokenFor(
  requestedType: NativeResultType | null,
  latestByType: Partial<Record<NativeResultType, number>>,
  latestResultStep: number,
) {
  if (requestedType && latestByType[requestedType] !== undefined) {
    return `{{step.${latestByType[requestedType]}.result.best}}`;
  }
  return latestResultStep >= 0 ? `{{step.${latestResultStep}.result.best}}` : "{{result.best}}";
}

function destinationTokenFor(
  requestedType: NativeResultType | null,
  latestByType: Partial<Record<NativeResultType, number>>,
  latestResultStep: number,
) {
  if (requestedType === "location" && latestByType.location !== undefined) {
    return `{{step.${latestByType.location}.result.destination}}`;
  }
  if (requestedType && latestByType[requestedType] !== undefined) {
    return `{{step.${latestByType[requestedType]}.result.best}}`;
  }
  return latestResultStep >= 0 ? `{{step.${latestResultStep}.result.destination}}` : "{{result.destination}}";
}

/**
 * Connects a later action to the semantically requested previous result.
 * If several earlier steps returned different types, phrases such as
 * "manda la ubicación" or "manda la grabación" bind to the latest matching
 * typed step instead of blindly consuming the immediately preceding result.
 */
function wireResultReferences(steps: NativeSequenceStep[]) {
  const latestByType: Partial<Record<NativeResultType, number>> = {};
  let latestResultStep = -1;

  return steps.map((step, index) => {
    const next = { ...step, payload: { ...step.payload } };

    if (latestResultStep >= 0 && refersToPriorResult(step.input)) {
      const requestedType = explicitReferencedType(step.input);
      const best = bestTokenFor(requestedType, latestByType, latestResultStep);

      switch (step.action) {
        case "open_whatsapp_target":
        case "messages.sms": {
          const existing = next.payload.message?.trim();
          next.payload.message = existing && !existing.includes("{{")
            ? `${existing} ${best}`
            : best;
          next.payload.source = requestedType ? `previous_${requestedType}` : "previous_result";
          break;
        }
        case "navigation.start":
          next.payload.destination = destinationTokenFor(requestedType, latestByType, latestResultStep);
          next.payload.source = requestedType ? `previous_${requestedType}` : "previous_result";
          break;
        case "schedule_native_notification": {
          const existing = next.payload.body?.trim();
          next.payload.body = existing && !existing.includes("{{")
            ? `${existing} ${best}`
            : best;
          next.payload.source = requestedType ? `previous_${requestedType}` : "previous_result";
          break;
        }
        case "open_url":
          next.payload.url = best;
          next.payload.source = requestedType ? `previous_${requestedType}` : "previous_result";
          break;
        default:
          break;
      }
    }

    if (step.resultType !== "unknown") {
      latestByType[step.resultType] = index;
      latestResultStep = index;
    }
    return next;
  });
}

export function buildNativeSequence(input: string): NativeSequenceStep[] | null {
  const clauses = splitSequentialClauses(input);
  if (clauses.length < 2 || clauses.length > 5) return null;

  const steps: NativeSequenceStep[] = [];
  for (const clause of clauses) {
    const resolution = resolveCapabilityRequest(clause);
    const decision = decideAction(resolution, clause);
    if (decision.kind !== "execute" || decision.transport !== "native") return null;

    steps.push({
      action: decision.target,
      capabilityId: decision.capabilityId,
      input: clause,
      payload: buildNativePayload(decision.target, clause),
      resultType: nativeResultType(decision.capabilityId, decision.target),
    });
  }

  return steps.length >= 2 ? wireResultReferences(steps) : null;
}
