const DEFAULT_GMAIL_QUERY = "in:inbox newer_than:7d";

export function normalizeGmailQuery(value: unknown) {
  if (typeof value !== "string") return DEFAULT_GMAIL_QUERY;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return clean || DEFAULT_GMAIL_QUERY;
}

export function validGmailMessageId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(value);
}
