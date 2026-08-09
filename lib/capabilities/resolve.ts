import { buildCapabilityExecutionPlan, type CapabilityExecutionPlan } from "./executor";
import { routeCapabilities, type CapabilityRoute } from "./router";

export type ZyronClientDirective =
  | {
      kind: "server_execute";
      capabilityId: string;
      endpoint: string;
      requiresConfirmation: boolean;
    }
  | {
      kind: "native_execute";
      capabilityId: string;
      action: string;
      requiresConfirmation: boolean;
    }
  | {
      kind: "request_access";
      capabilityId: string;
      action?: string;
      message: string;
    }
  | {
      kind: "fallback";
      capabilityId: string;
      message: string;
    };

export type ZyronCapabilityResolution = {
  primary: CapabilityRoute | null;
  alternatives: CapabilityRoute[];
  plan: CapabilityExecutionPlan | null;
  directive: ZyronClientDirective | null;
};

function directiveFromPlan(plan: CapabilityExecutionPlan): ZyronClientDirective {
  if (plan.mode === "execute" && plan.endpoint) {
    return {
      kind: "server_execute",
      capabilityId: plan.capabilityId,
      endpoint: plan.endpoint,
      requiresConfirmation: plan.requiresConfirmation,
    };
  }

  if ((plan.mode === "native_execute" || plan.mode === "handoff") && plan.nativeAction) {
    return {
      kind: "native_execute",
      capabilityId: plan.capabilityId,
      action: plan.nativeAction,
      requiresConfirmation: plan.requiresConfirmation,
    };
  }

  if (plan.mode === "request_access") {
    return {
      kind: "request_access",
      capabilityId: plan.capabilityId,
      action: plan.nativeAction,
      message: plan.userMessage || "Necesito un permiso o recurso que todavía no está autorizado.",
    };
  }

  return {
    kind: "fallback",
    capabilityId: plan.capabilityId,
    message: plan.userMessage || "Esta capacidad todavía no está conectada.",
  };
}

export function resolveCapabilityRequest(input: string): ZyronCapabilityResolution {
  const routes = routeCapabilities(input);
  const primary = routes[0] ?? null;
  if (!primary) {
    return { primary: null, alternatives: [], plan: null, directive: null };
  }

  const plan = buildCapabilityExecutionPlan(primary);
  return {
    primary,
    alternatives: routes.slice(1, 4),
    plan,
    directive: directiveFromPlan(plan),
  };
}
