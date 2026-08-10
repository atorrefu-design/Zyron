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
    "mandaselo",
    "mandasela",
    "enviaselo",
    "enviasela",
    "compartelo",
    "compartela",
  ].some((token) => text.includes(token));
}

/**
 * Connects a later action to the most useful representation of the preceding
 * typed result. The iPhone decides at runtime whether result.best means a share
 * link, a file URL, text, an identifier, etc.
 */
function wireResultReferences(steps: NativeSequenceStep[]) {
  let hasPriorResult = false;

  return steps.map((step) => {
    const next = { ...step, payload: { ...step.payload } };

    if (hasPriorResult && refersToPriorResult(step.input)) {
      const best = "{{result.best}}";
      switch (step.action) {
        case "open_whatsapp_target":
        case "messages.sms": {
          const existing = next.payload.message?.trim();
          next.payload.message = existing && !existing.includes("{{")
            ? `${existing} ${best}`
            : best;
          next.payload.source = "previous_result";
          break;
        }
        case "navigation.start":
          next.payload.destination = "{{result.destination}}";
          next.payload.source = "previous_result";
          break;
        case "schedule_native_notification": {
          const existing = next.payload.body?.trim();
          next.payload.body = existing && !existing.includes("{{")
            ? `${existing} ${best}`
            : best;
          next.payload.source = "previous_result";
          break;
        }
        case "open_url":
          next.payload.url = best;
          next.payload.source = "previous_result";
          break;
        default:
          break;
      }
    }

    if (step.resultType !== "unknown") hasPriorResult = true;
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
