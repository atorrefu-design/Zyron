import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDriveSearchQuery,
  driveContentMode,
  normalizeDriveContent,
  normalizeDriveName,
  validDriveFileId,
} from "../../lib/drive-policy.ts";
import { authorizeAgentTool } from "../../lib/agent/policy.ts";
import { classifyAgentToolFailure } from "../../lib/agent/tool-errors.ts";

test("Drive searches exclude trash and escape private search terms", () => {
  const query = buildDriveSearchQuery("Aaron's informe\\final");
  assert.match(query, /trashed = false/);
  assert.match(query, /Aaron\\'s/);
  assert.match(query, /informe\\\\final/);
});

test("Drive file identifiers are validated", () => {
  assert.equal(validDriveFileId("1AbCdEfGhIjKlMnOp"), true);
  assert.equal(validDriveFileId("bad/id"), false);
  assert.equal(validDriveFileId("short"), false);
});

test("Drive content reads are limited to safe text exports", () => {
  assert.deepEqual(driveContentMode("application/vnd.google-apps.document"), { mode: "export", mimeType: "text/plain" });
  assert.deepEqual(driveContentMode("text/plain"), { mode: "download", mimeType: "text/plain" });
  assert.equal(driveContentMode("application/pdf").mode, "unsupported");
});

test("Drive reads remain available and broad write operations stay blocked", () => {
  assert.equal(authorizeAgentTool("search_drive", "Busca el informe").allowed, true);
  assert.equal(authorizeAgentTool("read_drive_file", "Resume ese documento").allowed, true);
  assert.equal(authorizeAgentTool("delete_drive_file", "bórralo").allowed, false);
  assert.equal(authorizeAgentTool("share_drive_file", "compártelo").allowed, false);
  assert.equal(authorizeAgentTool("move_drive_file", "muévelo").allowed, false);
  assert.equal(authorizeAgentTool("update_drive_file", "edítalo").allowed, false);
});

test("Drive creation requires a separate explicit confirmation", () => {
  const folderDraft = authorizeAgentTool("create_drive_folder", "Crea una carpeta Pruebas ZYRON");
  const documentDraft = authorizeAgentTool("create_drive_document", "Guarda este texto en Drive");
  assert.equal(folderDraft.allowed, false);
  assert.equal(documentDraft.allowed, false);
  assert.match(folderDraft.reason, /mensaje posterior/);
  assert.equal(authorizeAgentTool("create_drive_folder", "Confirmo, crea la carpeta").allowed, true);
  assert.equal(authorizeAgentTool("create_drive_document", "Sí, guarda el documento").allowed, true);
});

test("Drive creation inputs are bounded and sanitized", () => {
  assert.equal(normalizeDriveName("  Informe\u0000   Brafa  "), "Informe Brafa");
  assert.equal(normalizeDriveName(" "), "");
  assert.equal(normalizeDriveContent("uno\u0000dos"), "unodos");
  assert.equal(normalizeDriveContent("x".repeat(50_001)).length, 50_000);
});

test("Drive permission errors request reauthorization", () => {
  assert.equal(classifyAgentToolFailure("search_drive", new Error("drive_scope_missing")).code, "drive_reconnect_required");
  assert.equal(classifyAgentToolFailure("search_drive", new Error("drive_api_403:accessNotConfigured")).code, "drive_api_unavailable");
  assert.equal(classifyAgentToolFailure("create_drive_folder", new Error("drive_write_scope_missing")).code, "drive_write_reconnect_required");
  assert.equal(classifyAgentToolFailure("create_drive_document", new Error("drive_write_403:insufficientPermissions")).code, "drive_write_permission_denied");
});
