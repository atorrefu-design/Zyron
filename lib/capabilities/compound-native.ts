import { decideAction } from "./action-policy";
import { buildNativePayload, type NativePayload } from "./native-payload";
import { resolveCapabilityRequest } from "./resolve";

export type NativeSequenceStep = {
  action: string;
  capabilityId: string;
  input: string;
  payload: NativePayload;
};

function stripWakeWord(value: string) {
  return value.replace(/^\s*(zyron|zayron)[,\s:-]*/i, "").trim();
}

function splitSequentialClauses(input: string): string[] {
  const clean = stripWakeWord(input);
  if (/\b(si|cuando|después de que|despues de que)\b/i.test(clean)) return [];

  return clean
    .split(/\s+(?:y\s+luego|y\s+despu[eé]s|luego|despu[eé]s|y)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
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
    });
  }

  return steps.length >= 2 ? steps : null;
}
