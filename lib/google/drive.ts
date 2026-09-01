import {
  buildDriveSearchQuery,
  driveContentMode,
  DRIVE_FOLDER_MIME,
} from "../drive-policy";
import {
  connectionHasScope,
  DRIVE_READONLY_SCOPE,
  getGoogleAccessToken,
  getGoogleConnection,
} from "./oauth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const MAX_DRIVE_TEXT_BYTES = 512 * 1024;
const MAX_DRIVE_EXCERPT_CHARS = 12_000;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number | null;
  webViewLink: string | null;
  isFolder: boolean;
};

export type DriveFileContent = DriveFile & {
  textExcerpt: string;
  truncated: boolean;
  contentTrust: "untrusted_drive_file";
};

type DriveFileResponse = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
};

type DriveListResponse = { files?: DriveFileResponse[]; nextPageToken?: string };

function mappedFile(file: DriveFileResponse): DriveFile {
  return {
    id: file.id || "",
    name: file.name?.trim() || "Archivo sin nombre",
    mimeType: file.mimeType || "application/octet-stream",
    modifiedTime: file.modifiedTime || null,
    size: file.size && Number.isFinite(Number(file.size)) ? Number(file.size) : null,
    webViewLink: file.webViewLink || null,
    isFolder: file.mimeType === DRIVE_FOLDER_MIME,
  };
}

async function assertDriveReady() {
  const connection = await getGoogleConnection();
  if (!connection) throw new Error("google_not_connected");
  if (!connectionHasScope(connection.scope, DRIVE_READONLY_SCOPE)) throw new Error("drive_scope_missing");
}

async function driveJson<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`drive_api_${response.status}${detail ? `:${detail.slice(0, 220)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function driveText(path: string, accessToken: string) {
  const response = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`drive_api_${response.status}${detail ? `:${detail.slice(0, 220)}` : ""}`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_DRIVE_TEXT_BYTES) throw new Error("drive_file_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DRIVE_TEXT_BYTES) throw new Error("drive_file_too_large");
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function searchDriveFiles(search: string, limit = 10): Promise<DriveFile[]> {
  await assertDriveReady();
  const accessToken = await getGoogleAccessToken();
  const params = new URLSearchParams({
    q: buildDriveSearchQuery(search),
    spaces: "drive",
    orderBy: "modifiedTime desc",
    pageSize: String(Math.max(1, Math.min(15, limit))),
    fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
  });
  const data = await driveJson<DriveListResponse>(`/files?${params.toString()}`, accessToken);
  return (data.files ?? []).map(mappedFile).filter((file) => file.id);
}

export async function readDriveFile(fileId: string): Promise<DriveFileContent> {
  await assertDriveReady();
  const accessToken = await getGoogleAccessToken();
  const fields = encodeURIComponent("id,name,mimeType,modifiedTime,size,webViewLink");
  const metadata = mappedFile(await driveJson<DriveFileResponse>(`/files/${encodeURIComponent(fileId)}?fields=${fields}`, accessToken));
  const content = driveContentMode(metadata.mimeType);
  if (content.mode === "unsupported") throw new Error(`drive_content_unsupported:${metadata.mimeType}`);

  const path = content.mode === "export"
    ? `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(content.mimeType)}`
    : `/files/${encodeURIComponent(fileId)}?alt=media`;
  const text = (await driveText(path, accessToken))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    ...metadata,
    textExcerpt: text.slice(0, MAX_DRIVE_EXCERPT_CHARS),
    truncated: text.length > MAX_DRIVE_EXCERPT_CHARS,
    contentTrust: "untrusted_drive_file",
  };
}
