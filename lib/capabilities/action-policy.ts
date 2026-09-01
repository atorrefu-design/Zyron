import type { ZyronCapabilityResolution } from "./resolve.ts";

export type ActionDecision =
  | { kind: "execute"; capabilityId: string; transport: "server" | "native"; target: string }
  | { kind: "confirm"; capabilityId: string; transport: "server" | "native"; target: string }
  | { kind: "request_access"; capabilityId: string; action?: string; message: string }
  | { kind: "fallback"; capabilityId: string; message: string }
  | { kind: "converse" };

function normalize(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function requestNeedsConfirmation(capabilityId: string, input: string, defaultValue: boolean) {
  const text = normalize(input);

  // Creation and read operations should normally be immediate. Confirmation is
  // reserved for destructive or materially consequential changes.
  if (capabilityId === "calendar.events") {
    if (/\b(borra|borra todo|elimina|cancela|suprime|quita|mueve|cambia|modifica|edita|reprograma)\b/.test(text)) return true;
    if (/\b(crea|anade|agenda|apunta|programa|consulta|mira|dime|que tengo|cuando)\b/.test(text)) return false;
  }

  if (capabilityId === "tasks.manage") {
    if (/\b(borra|elimina|vacía|vacia|quita todas|borra todas)\b/.test(text)) return true;
    return false;
  }

  if (capabilityId === "recording.control") return false;
  if (capabilityId === "notifications.native") return false;
  if (capabilityId === "maps.mobility" || capabilityId === "web.current_info" || capabilityId === "basketball.fcbq") return false;

  return defaultValue;
}

/**
 * Global ZYRON policy: plans are internal implementation details.
 * The user asks for an outcome; ZYRON executes it whenever an authorised
 * executor exists. We only interrupt for a required confirmation, a real
 * permission/resource boundary, or a missing capability.
 */
export function decideAction(resolution: ZyronCapabilityResolution, input = ""): ActionDecision {
  const directive = resolution.directive;
  if (!directive) return { kind: "converse" };

  if (directive.kind === "server_execute") {
    const base = {
      capabilityId: directive.capabilityId,
      transport: "server" as const,
      target: directive.endpoint,
    };
    return requestNeedsConfirmation(directive.capabilityId, input, directive.requiresConfirmation)
      ? { kind: "confirm", ...base }
      : { kind: "execute", ...base };
  }

  if (directive.kind === "native_execute") {
    const base = {
      capabilityId: directive.capabilityId,
      transport: "native" as const,
      target: directive.action,
    };
    return requestNeedsConfirmation(directive.capabilityId, input, directive.requiresConfirmation)
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
