import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDriveSearchQuery,
  driveContentMode,
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

test("Drive tools are read-only and write operations remain blocked", () => {
  assert.equal(authorizeAgentTool("search_drive", "Busca el informe").allowed, true);
  assert.equal(authorizeAgentTool("read_drive_file", "Resume ese documento").allowed, true);
  assert.equal(authorizeAgentTool("delete_drive_file", "bórralo").allowed, false);
  assert.equal(authorizeAgentTool("share_drive_file", "compártelo").allowed, false);
});

test("Drive permission errors request reauthorization", () => {
  assert.equal(classifyAgentToolFailure("search_drive", new Error("drive_scope_missing")).code, "drive_reconnect_required");
  assert.equal(classifyAgentToolFailure("search_drive", new Error("drive_api_403:accessNotConfigured")).code, "drive_api_unavailable");
});
