import { type ZyronCapabilityResolution } from "./resolve";

export type ZyronExecutionDecision = {
  mode: "execute_now" | "ask_confirmation" | "ask_permission" | "unavailable" | "conversation";
  capabilityId?: string;
  reason: string;
};

/**
 * Global ZYRON execution policy.
 *
 * Product rule: if the user asks for an outcome and ZYRON has an authorised,
 * technically available path to achieve it, execute the action instead of
 * explaining the plan or telling the user how to do it manually.
 */
export function decideExecution(resolution: ZyronCapabilityResolution): ZyronExecutionDecision {
  const { primary, directive } = resolution;

  if (!primary || !directive) {
    return {
      mode: "conversation",
      reason: "No specialised capability is required; answer conversationally.",
    };
  }

  if (directive.kind === "server_execute") {
    if (directive.requiresConfirmation) {
      return {
        mode: "ask_confirmation",
        capabilityId: directive.capabilityId,
        reason: "The capability can execute, but policy requires confirmation for this write/sensitive action.",
      };
    }

    return {
      mode: "execute_now",
      capabilityId: directive.capabilityId,
      reason: "Server capability is available and authorised; execute immediately.",
    };
  }

  if (directive.kind === "native_action") {
    if (directive.requiresConfirmation) {
      return {
        mode: "ask_confirmation",
        capabilityId: directive.capabilityId,
        reason: "Native capability is available, but policy requires confirmation.",
      };
    }

    return {
      mode: "execute_now",
      capabilityId: directive.capabilityId,
      reason: "Native capability is available; dispatch it to the iPhone companion immediately.",
    };
  }

  if (directive.kind === "request_access") {
    return {
      mode: "ask_permission",
      capabilityId: directive.capabilityId,
      reason: "Execution is blocked only by an operating-system permission or a specific resource that is not yet authorised.",
    };
  }

  return {
    mode: "unavailable",
    capabilityId: directive.capabilityId,
    reason: "No executable route exists yet. Do not pretend the action was completed.",
  };
}

export const ACTION_FIRST_PRINCIPLES = [
  "Execute outcomes, do not narrate plans.",
  "Use the best available capability automatically.",
  "Ask only when a real permission, ambiguity, safety confirmation or missing capability blocks execution.",
  "Never claim an action succeeded unless its executor confirms success.",
  "After success, answer with the result or a short acknowledgement, not implementation details.",
] as const;
