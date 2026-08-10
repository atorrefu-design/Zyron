import { decideAction } from "./action-policy";
import { buildNativePayload, type NativePayload } from "./native-payload";
import { resolveCapabilityRequest } from "./resolve";

export type NativeConditionalStep = {
  action: string;
  capabilityId: string;
  input: string;
  payload: NativePayload;
};

export type NativeConditionalPlan = {
  primary: NativeConditionalStep;
  condition: "on_success" | "on_failure";
  branch: NativeConditionalStep;
};

function stripWakeWord(value: string) {
  return value.replace(/^\s*(zyron|zayron)[,\s:-]*/i, "").trim();
}

function buildStep(clause: string): NativeConditionalStep | null {
  const input = clause.trim();
  if (!input) return null;
  const resolution = resolveCapabilityRequest(input);
  const decision = decideAction(resolution, input);
  if (decision.kind !== "execute" || decision.transport !== "native") return null;
  return {
    action: decision.target,
    capabilityId: decision.capabilityId,
    input,
    payload: buildNativePayload(decision.target, input),
  };
}

/**
 * Supports conditions ZYRON can actually observe: whether the preceding native
 * action succeeded or failed. It intentionally does not claim to observe
 * external app state such as whether a person answered a phone call.
 */
export function buildNativeConditional(input: string): NativeConditionalPlan | null {
  const clean = stripWakeWord(input);

  const failurePatterns = [
    /^(.+?)(?:,?\s+y)?\s+si\s+(?:eso\s+)?(?:falla|no\s+funciona|no\s+se\s+abre|no\s+puedes|no\s+se\s+puede)(?:,?\s+entonces)?\s+(.+)$/i,
    /^(.+?)(?:,?\s+y)?\s+si\s+no\s+sale\s+bien(?:,?\s+entonces)?\s+(.+)$/i,
  ];
  for (const pattern of failurePatterns) {
    const match = clean.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const primary = buildStep(match[1]);
    const branch = buildStep(match[2]);
    if (primary && branch) return { primary, condition: "on_failure", branch };
  }

  const successPatterns = [
    /^(.+?)(?:,?\s+y)?\s+si\s+(?:eso\s+)?(?:funciona|sale\s+bien|se\s+abre)(?:,?\s+entonces)?\s+(.+)$/i,
  ];
  for (const pattern of successPatterns) {
    const match = clean.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const primary = buildStep(match[1]);
    const branch = buildStep(match[2]);
    if (primary && branch) return { primary, condition: "on_success", branch };
  }

  return null;
}
