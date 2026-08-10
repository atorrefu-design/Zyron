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
  primary: NativeConditionalStep;
  condition: "on_success" | "on_failure";
  branch: NativeConditionalStep;
};

const MAX_CONDITIONAL_DEPTH = 3;

function stripWakeWord(value: string) {
  return value.replace(/^\s*(zyron|zayron)[,\s:-]*/i, "").trim();
}

function buildSingleStep(clause: string): NativeConditionalStep | null {
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

function wrapSequence(input: string): NativeConditionalStep | null {
  const sequence = buildNativeSequence(input);
  if (!sequence?.length) return null;
  return {
    action: "sequence.execute",
    capabilityId: "native.sequence",
    input,
    payload: { steps: JSON.stringify(sequence) },
  };
}

function wrapConditional(input: string, depth: number): NativeConditionalStep | null {
  if (depth >= MAX_CONDITIONAL_DEPTH) return null;
  const nested = buildNativeConditionalInternal(input, depth + 1);
  if (!nested) return null;
  return {
    action: "conditional.execute",
    capabilityId: "native.conditional",
    input,
    payload: { plan: JSON.stringify(nested) },
  };
}

/**
 * A branch can itself be another condition, a sequence, or one native action.
 * This reuses the executors already supported by the iPhone companion.
 */
function buildExecutableStep(clause: string, depth: number): NativeConditionalStep | null {
  const input = clause.trim();
  if (!input) return null;
  return wrapConditional(input, depth) ?? wrapSequence(input) ?? buildSingleStep(input);
}

function makePlan(
  primaryClause: string,
  condition: NativeConditionalPlan["condition"],
  branchClause: string,
  depth: number,
): NativeConditionalPlan | null {
  const primary = buildExecutableStep(primaryClause, depth);
  const branch = buildExecutableStep(branchClause, depth);
  if (!primary || !branch) return null;
  return { primary, condition, branch };
}

function buildNativeConditionalInternal(input: string, depth: number): NativeConditionalPlan | null {
  if (depth > MAX_CONDITIONAL_DEPTH) return null;
  const clean = stripWakeWord(input);

  const failurePatterns = [
    /^(.+?)(?:,?\s+y)?\s+si\s+(?:eso\s+)?(?:falla|no\s+funciona|no\s+se\s+abre|no\s+puedes|no\s+se\s+puede)(?:,?\s+entonces)?\s+(.+)$/i,
    /^(.+?)(?:,?\s+y)?\s+si\s+no\s+sale\s+bien(?:,?\s+entonces)?\s+(.+)$/i,
  ];
  for (const pattern of failurePatterns) {
    const match = clean.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const plan = makePlan(match[1], "on_failure", match[2], depth);
    if (plan) return plan;
  }

  const successPatterns = [
    /^(.+?)(?:,?\s+y)?\s+si\s+(?:eso\s+)?(?:funciona|sale\s+bien|se\s+abre)(?:,?\s+entonces)?\s+(.+)$/i,
  ];
  for (const pattern of successPatterns) {
    const match = clean.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const plan = makePlan(match[1], "on_success", match[2], depth);
    if (plan) return plan;
  }

  return null;
}

/**
 * Supports nested conditions only when they are based on outcomes ZYRON can
 * actually observe: native success or failure. It does not claim to observe
 * external app state such as whether a person answered a phone call.
 */
export function buildNativeConditional(input: string): NativeConditionalPlan | null {
  return buildNativeConditionalInternal(input, 0);
}
