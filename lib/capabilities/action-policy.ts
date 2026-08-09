import type { ZyronCapabilityResolution } from "./resolve";

export type ActionDecision =
  | { kind: "execute"; capabilityId: string; transport: "server" | "native"; target: string }
  | { kind: "confirm"; capabilityId: string; transport: "server" | "native"; target: string }
  | { kind: "request_access"; capabilityId: string; action?: string; message: string }
  | { kind: "fallback"; capabilityId: string; message: string }
  | { kind: "converse" };

/**
 * Global ZYRON policy: plans are internal implementation details.
 * The user asks for an outcome; ZYRON executes it whenever an authorised
 * executor exists. We only interrupt for a required confirmation, a real
 * permission/resource boundary, or a missing capability.
 */
export function decideAction(resolution: ZyronCapabilityResolution): ActionDecision {
  const directive = resolution.directive;
  if (!directive) return { kind: "converse" };

  if (directive.kind === "server_execute") {
    const base = {
      capabilityId: directive.capabilityId,
      transport: "server" as const,
      target: directive.endpoint,
    };
    return directive.requiresConfirmation
      ? { kind: "confirm", ...base }
      : { kind: "execute", ...base };
  }

  if (directive.kind === "native_execute") {
    const base = {
      capabilityId: directive.capabilityId,
      transport: "native" as const,
      target: directive.action,
    };
    return directive.requiresConfirmation
      ? { kind: "confirm", ...base }
      : { kind: "execute", ...base };
  }

  if (directive.kind === "request_access") {
    return {
      kind: "request_access",
      capabilityId: directive.capabilityId,
      action: directive.action,
      message: directive.message,
    };
  }

  return {
    kind: "fallback",
    capabilityId: directive.capabilityId,
    message: directive.message,
  };
}

export function mayClaimSuccess(decision: ActionDecision, executorSucceeded: boolean): boolean {
  return decision.kind === "execute" && executorSucceeded;
}
