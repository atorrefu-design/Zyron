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

function wireResultReferences(steps: NativeSequenceStep[]) {
  let lastLocationStep = -1;

  return steps.map((step, index) => {
    const next = { ...step, payload: { ...step.payload } };
    if (step.resultType === "location") {
      lastLocationStep = index;
      return next;
    }

    if (lastLocationStep < 0) return next;
    const text = normalize(step.input);
    const refersToLocation = [
      "mi ubicacion",
      "esa ubicacion",
      "la ubicacion",
      "ubicacion actual",
      "mandasela",
      "enviasela",
      "compartela",
    ].some((token) => text.includes(token));

    if (!refersToLocation) return next;

    if (step.action === "open_whatsapp_target" || step.action === "messages.sms") {
      const existing = next.payload.message?.trim();
      const locationToken = "{{location.current.share}}";
      next.payload.message = existing && !existing.includes("{{")
        ? `${existing} ${locationToken}`
        : locationToken;
      next.payload.sourceStep = String(lastLocationStep);
      next.payload.sourceType = "location";
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
