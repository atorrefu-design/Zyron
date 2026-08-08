export type VoiceResponseMode = "audio" | "text";

export type VoiceCommunicationPolicy = {
  timeZone: "Europe/Madrid";
  localHour: number;
  wakeWord: "ZYRON";
  responseMode: VoiceResponseMode;
  quietHours: {
    startHour: 1;
    endHour: 7;
  };
  shouldSpeak: boolean;
  textDelivery: "in_app_or_notification" | null;
};

const TIME_ZONE = "Europe/Madrid" as const;
const QUIET_START_HOUR = 1 as const;
const QUIET_END_HOUR = 7 as const;

function hourInMadrid(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour : 0;
}

export function getVoiceCommunicationPolicy(date = new Date()): VoiceCommunicationPolicy {
  const localHour = hourInMadrid(date);
  const quiet = localHour >= QUIET_START_HOUR && localHour < QUIET_END_HOUR;

  return {
    timeZone: TIME_ZONE,
    localHour,
    wakeWord: "ZYRON",
    responseMode: quiet ? "text" : "audio",
    quietHours: {
      startHour: QUIET_START_HOUR,
      endHour: QUIET_END_HOUR,
    },
    shouldSpeak: !quiet,
    textDelivery: quiet ? "in_app_or_notification" : null,
  };
}
