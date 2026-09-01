export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_DOC_MIME = "application/vnd.google-apps.document";
export const DRIVE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export function normalizeDriveSearch(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function buildDriveSearchQuery(value: unknown) {
  const search = normalizeDriveSearch(value);
  if (!search) return "trashed = false";
  const escaped = escapeDriveQueryValue(search);
  return `trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`;
}

export function validDriveFileId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(value);
}

export function driveContentMode(mimeType: string) {
  if (mimeType === DRIVE_DOC_MIME) return { mode: "export" as const, mimeType: "text/plain" };
  if (mimeType === DRIVE_SHEET_MIME) return { mode: "export" as const, mimeType: "text/csv" };
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/csv") {
    return { mode: "download" as const, mimeType };
  }
  return { mode: "unsupported" as const, mimeType };
}
