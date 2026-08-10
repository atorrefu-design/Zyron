import { decideAction } from "./action-policy";
import { buildNativeSequence } from "./compound-native";
import { buildNativePayload, type NativePayload } from "./native-payload";
import { resolveCapabilityRequest } from "./resolve";

export type NativeConditionalStep = {
  action: string;
  capabilityId: string;
  input: string;
  payload: NativePayload;
};

export type NativeConditionalPlan = {
  primarySteps: NativeConditionalStep[];
  condition: "on_success" | "on_failure";
  branchSteps: NativeConditionalStep[];
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

function buildSteps(clause: string): NativeConditionalStep[] | null {
  const sequence = buildNativeSequence(clause);
  if (sequence?.length) return sequence;
  const step = buildStep(clause);
  return step ? [step] : null;
}

function makePlan(primaryClause: string, condition: NativeConditionalPlan["condition"], branchClause: string) {
  const primarySteps = buildSteps(primaryClause);
  const branchSteps = buildSteps(branchClause);
  if (!primarySteps?.length || !branchSteps?.length) return null;
  return { primarySteps, condition, branchSteps } satisfies NativeConditionalPlan;
}

/**
 * Supports only conditions ZYRON can actually observe: whether the preceding
 * native action or sequence succeeded or failed. It intentionally does not
 * claim to observe external state such as whether a person answered a call.
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
    const plan = makePlan(match[1], "on_failure", match[2]);
    if (plan) return plan;
  }

  const successPatterns = [
    /^(.+?)(?:,?\s+y)?\s+si\s+(?:eso\s+)?(?:funciona|sale\s+bien|se\s+abre)(?:,?\s+entonces)?\s+(.+)$/i,
  ];
  for (const pattern of successPatterns) {
    const match = clean.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const plan = makePlan(match[1], "on_success", match[2]);
    if (plan) return plan;
  }

  return null;
}
