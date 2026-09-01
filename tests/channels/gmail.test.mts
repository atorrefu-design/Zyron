import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGmailQuery, validGmailMessageId } from "../../lib/gmail-query.ts";
import { authorizeAgentTool } from "../../lib/agent/policy.ts";
import { classifyAgentToolFailure } from "../../lib/agent/tool-errors.ts";

test("Gmail queries are bounded and default to recent inbox mail", () => {
  assert.equal(normalizeGmailQuery("  in:inbox   is:unread  "), "in:inbox is:unread");
  assert.equal(normalizeGmailQuery(""), "in:inbox newer_than:7d");
  assert.ok(normalizeGmailQuery("a".repeat(500)).length <= 300);
});

test("Gmail message identifiers are validated before remote reads", () => {
  assert.equal(validGmailMessageId("18f0abcDEF_123"), true);
  assert.equal(validGmailMessageId("bad/id"), false);
  assert.equal(validGmailMessageId("x"), false);
});

test("Gmail agent tools are strictly read-only", () => {
  assert.equal(authorizeAgentTool("search_gmail", "Qué correos tengo sin leer").allowed, true);
  assert.equal(authorizeAgentTool("read_gmail_message", "Resume el primero").allowed, true);
  assert.equal(authorizeAgentTool("send_email", "envíalo").allowed, false);
  assert.equal(authorizeAgentTool("delete_email", "bórralo").allowed, false);
});

test("Gmail permission failures request reauthorization", () => {
  const missing = classifyAgentToolFailure("search_gmail", new Error("gmail_scope_missing"));
  assert.equal(missing.code, "gmail_reconnect_required");
  const disabled = classifyAgentToolFailure("search_gmail", new Error("gmail_api_403:accessNotConfigured"));
  assert.equal(disabled.code, "gmail_api_unavailable");
});
