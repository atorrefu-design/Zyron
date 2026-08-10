export type NativeResultType = "location" | "file" | "notification" | "executor" | "url" | "text" | "unknown";

const CAPABILITY_RESULT_TYPES: Record<string, NativeResultType> = {
  "location.current": "location",
  "recording.control": "file",
  "notifications.native": "notification",
  "apps.open": "executor",
  "media.play": "executor",
  "maps.navigation": "text",
  "phone.call": "text",
  "messages.sms": "text",
  "whatsapp.handoff": "text",
};

const ACTION_RESULT_TYPES: Record<string, NativeResultType> = {
  get_current_location: "location",
  "recording.start": "file",
  "recording.stop": "file",
  recording_control: "file",
  schedule_native_notification: "notification",
  "app.open": "executor",
  "media.play": "executor",
  open_url: "url",
};

export function nativeResultType(capabilityId: string, action: string): NativeResultType {
  return CAPABILITY_RESULT_TYPES[capabilityId] ?? ACTION_RESULT_TYPES[action] ?? "unknown";
}
