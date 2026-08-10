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

function explicitReferencedType(input: string): NativeResultType | null {
  const text = normalize(input);
  if (["ubicacion", "donde estoy", "coordenadas"].some((token) => text.includes(token))) return "location";
  if (["grabacion", "audio", "archivo", "fichero"].some((token) => text.includes(token))) return "file";
  if (["notificacion", "aviso"].some((token) => text.includes(token))) return "notification";
  if (["enlace", "url", "link"].some((token) => text.includes(token))) return "url";
  if (["texto", "mensaje", "resultado"].some((token) => text.includes(token))) return "text";
  return null;
}

function refersToPriorResult(input: string) {
  const text = normalize(input);
  return [
    "eso", "ese resultado", "el resultado", "esa ubicacion", "la ubicacion", "mi ubicacion",
    "ubicacion actual", "ubicacion de antes", "ubicacion anterior", "ese archivo", "el archivo",
    "esa grabacion", "la grabacion", "grabacion anterior", "ultima grabacion", "ese audio", "el audio",
    "ese enlace", "el enlace", "el anterior", "la anterior", "lo anterior", "el primero", "la primera",
    "el segundo", "la segunda", "el tercero", "la tercera", "el cuarto", "la cuarta", "el quinto",
    "la quinta", "primer resultado", "segundo resultado", "tercer resultado", "cuarto resultado",
    "quinto resultado", "ultimo resultado", "ultima salida", "mandaselo", "mandasela", "enviaselo",
    "enviasela", "compartelo", "compartela",
  ].some((token) => text.includes(token));
}

function resultIndexesBefore(steps: NativeSequenceStep[], currentIndex: number) {
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step, index }) => index < currentIndex && step.resultType !== "unknown")
    .map(({ index }) => index);
}

function explicitReferencedStep(input: string, steps: NativeSequenceStep[], currentIndex: number): number | null {
  const text = normalize(input);
  const prior = resultIndexesBefore(steps, currentIndex);
  if (!prior.length) return null;

  if (["el anterior", "la anterior", "lo anterior", "resultado anterior"].some((token) => text.includes(token))) {
    return prior[prior.length - 1];
  }

  if (["el primero", "la primera", "primer resultado", "primera salida"].some((token) => text.includes(token))) return prior[0] ?? null;
  if (["el segundo", "la segunda", "segundo resultado", "segunda salida"].some((token) => text.includes(token))) return prior[1] ?? null;
  if (["el tercero", "la tercera", "tercer resultado", "tercera salida"].some((token) => text.includes(token))) return prior[2] ?? null;
  if (["el cuarto", "la cuarta", "cuarto resultado", "cuarta salida"].some((token) => text.includes(token))) return prior[3] ?? null;
  if (["el quinto", "la quinta", "quinto resultado", "quinta salida"].some((token) => text.includes(token))) return prior[4] ?? null;

  if (["ultimo resultado", "ultima salida"].some((token) => text.includes(token))) return prior[prior.length - 1];
  return null;
}

function typedReferencedStep(
  requestedType: NativeResultType | null,
  latestByType: Partial<Record<NativeResultType, number>>,
) {
  if (!requestedType) return null;
  return latestByType[requestedType] ?? null;
}

function bestTokenForStep(stepIndex: number) {
  return `{{step.${stepIndex}.result.best}}`;
}

function destinationTokenForStep(stepIndex: number, resultType: NativeResultType | null) {
  return resultType === "location"
    ? `{{step.${stepIndex}.result.destination}}`
    : `{{step.${stepIndex}.result.best}}`;
}

/**
 * Connects later actions to the exact earlier result the user refers to.
 * Resolution order is: explicit ordinal/temporal reference, explicit result
 * type, then the most recent prior result.
 */
function wireResultReferences(steps: NativeSequenceStep[]) {
  const latestByType: Partial<Record<NativeResultType, number>> = {};
  let latestResultStep = -1;

  return steps.map((step, index) => {
    const next = { ...step, payload: { ...step.payload } };

    if (latestResultStep >= 0 && refersToPriorResult(step.input)) {
      const requestedType = explicitReferencedType(step.input);
      const ordinalStep = explicitReferencedStep(step.input, steps, index);
      const typedStep = typedReferencedStep(requestedType, latestByType);
      const sourceStep = ordinalStep ?? typedStep ?? latestResultStep;
      const sourceType = steps[sourceStep]?.resultType ?? requestedType;
      const best = bestTokenForStep(sourceStep);

      switch (step.action) {
        case "open_whatsapp_target":
        case "messages.sms": {
          const existing = next.payload.message?.trim();
          next.payload.message = existing && !existing.includes("{{") ? `${existing} ${best}` : best;
          next.payload.source = `step_${sourceStep}`;
          next.payload.sourceType = sourceType ?? "unknown";
          break;
        }
        case "navigation.start":
          next.payload.destination = destinationTokenForStep(sourceStep, sourceType ?? null);
          next.payload.source = `step_${sourceStep}`;
          next.payload.sourceType = sourceType ?? "unknown";
          break;
        case "schedule_native_notification": {
          const existing = next.payload.body?.trim();
          next.payload.body = existing && !existing.includes("{{") ? `${existing} ${best}` : best;
          next.payload.source = `step_${sourceStep}`;
          next.payload.sourceType = sourceType ?? "unknown";
          break;
        }
        case "open_url":
          next.payload.url = best;
          next.payload.source = `step_${sourceStep}`;
          next.payload.sourceType = sourceType ?? "unknown";
          break;
        default:
          break;
      }
    }

    if (step.resultType !== "unknown") {
      latestByType[step.resultType] = index;
      latestResultStep = index;
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
