export type ZyronCapabilityAccessLevel =
  | "direct"
  | "app_intent"
  | "share_import"
  | "web_adapter"
  | "handoff";

export type ZyronCapabilityRisk = "low" | "medium" | "high";

export type ZyronCapability = {
  id: string;
  label: string;
  domain: string;
  accessLevel: ZyronCapabilityAccessLevel;
  canRead: boolean;
  canWrite: boolean;
  requiresUserInteraction: boolean;
  requiresConfirmation: boolean;
  risk: ZyronCapabilityRisk;
  status: "available" | "partial" | "planned";
  fallback?: string;
};

export const zyronCapabilities: readonly ZyronCapability[] = [
  {
    id: "calendar.events",
    label: "Calendario",
    domain: "productivity",
    accessLevel: "direct",
    canRead: true,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: true,
    risk: "medium",
    status: "available",
  },
  {
    id: "tasks.manage",
    label: "Tareas",
    domain: "productivity",
    accessLevel: "direct",
    canRead: true,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "available",
  },
  {
    id: "location.current",
    label: "Ubicación actual",
    domain: "device",
    accessLevel: "direct",
    canRead: true,
    canWrite: false,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "high",
    status: "available",
  },
  {
    id: "contacts.resolve",
    label: "Contactos seleccionados",
    domain: "communication",
    accessLevel: "direct",
    canRead: true,
    canWrite: false,
    requiresUserInteraction: true,
    requiresConfirmation: false,
    risk: "high",
    status: "partial",
    fallback: "Solicitar acceso de iOS y resolver únicamente los contactos autorizados por el propietario.",
  },
  {
    id: "apps.open",
    label: "Abrir aplicaciones",
    domain: "device",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "partial",
    fallback: "Abrir la aplicación cuando iOS o la propia app expongan un enlace compatible.",
  },
  {
    id: "phone.call",
    label: "Llamadas",
    domain: "communication",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: true,
    requiresConfirmation: false,
    risk: "high",
    status: "partial",
    fallback: "Preparar la llamada mediante la vía telefónica permitida por iOS.",
  },
  {
    id: "messages.sms",
    label: "Mensajes SMS",
    domain: "communication",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: true,
    requiresConfirmation: false,
    risk: "high",
    status: "partial",
    fallback: "Preparar el mensaje en la interfaz de mensajería permitida por iOS.",
  },
  {
    id: "media.play",
    label: "Música y multimedia",
    domain: "media",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "partial",
    fallback: "Abrir el contenido en el reproductor o servicio compatible más fiable.",
  },
  {
    id: "maps.navigation",
    label: "Navegación",
    domain: "mobility",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "partial",
    fallback: "Abrir la navegación compatible en el iPhone.",
  },
  {
    id: "maps.mobility",
    label: "Movilidad y mapas",
    domain: "mobility",
    accessLevel: "web_adapter",
    canRead: true,
    canWrite: false,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "available",
  },
  {
    id: "web.current_info",
    label: "Información actual en web",
    domain: "knowledge",
    accessLevel: "web_adapter",
    canRead: true,
    canWrite: false,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "available",
  },
  {
    id: "basketball.fcbq",
    label: "FCBQ / baloncesto",
    domain: "basketball",
    accessLevel: "web_adapter",
    canRead: true,
    canWrite: false,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "planned",
    fallback: "Consultar la mejor fuente web disponible y priorizar la fuente oficial.",
  },
  {
    id: "recording.control",
    label: "Grabación de audio",
    domain: "media",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "high",
    status: "partial",
    fallback: "Usar la grabación nativa del companion cuando esté instalada y autorizada.",
  },
  {
    id: "recordings.import",
    label: "Grabaciones y notas de voz",
    domain: "media",
    accessLevel: "share_import",
    canRead: true,
    canWrite: false,
    requiresUserInteraction: true,
    requiresConfirmation: false,
    risk: "high",
    status: "planned",
    fallback: "Compartir la grabación con ZYRON o autorizar un archivo/carpeta.",
  },
  {
    id: "whatsapp.handoff",
    label: "WhatsApp",
    domain: "messaging",
    accessLevel: "handoff",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: true,
    requiresConfirmation: false,
    risk: "high",
    status: "partial",
    fallback: "Abrir WhatsApp o el destino compatible y continuar con el usuario.",
  },
  {
    id: "files.authorized",
    label: "Archivos autorizados",
    domain: "files",
    accessLevel: "share_import",
    canRead: true,
    canWrite: true,
    requiresUserInteraction: true,
    requiresConfirmation: false,
    risk: "high",
    status: "planned",
  },
  {
    id: "notifications.native",
    label: "Notificaciones nativas",
    domain: "device",
    accessLevel: "direct",
    canRead: false,
    canWrite: true,
    requiresUserInteraction: false,
    requiresConfirmation: false,
    risk: "low",
    status: "partial",
  },
] as const;

export function findCapability(id: string): ZyronCapability | undefined {
  return zyronCapabilities.find((capability) => capability.id === id);
}

export function listCapabilitiesByDomain(domain: string): ZyronCapability[] {
  return zyronCapabilities.filter((capability) => capability.domain === domain);
}
