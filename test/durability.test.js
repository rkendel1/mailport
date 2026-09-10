import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileMailStore, createOutboxWorker, createMimeMessage } from "../src/index.js";

const base = { message_id: "msg_1", status: "queued", attempt: 0, next_retry_at: null,
  lease_expires_at: null, claim_token: null, claimed_by: null };

test("file store survives recreation and fences stale workers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-"));
  const filePath = path.join(directory, "outbox.json");
  const first = new FileMailStore({ filePath });
  first.create(base);
  const claimA = first.claimNext("worker-a", { leaseMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = new FileMailStore({ filePath });
  const claimB = second.claimNext("worker-b", { leaseMs: 1000 });
  await assert.rejects(() => first.complete("msg_1", claimA.claim_token), { code: "MAIL_LEASE_LOST" });
  await second.complete("msg_1", claimB.claim_token);
  assert.equal(new FileMailStore({ filePath }).get("msg_1").status, "sent");
});

test("two stores cannot claim one message concurrently", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-"));
  const filePath = path.join(directory, "outbox.json");
  const a = new FileMailStore({ filePath });
  const b = new FileMailStore({ filePath });
  a.create(base);
  assert.ok(a.claimNext("a"));
  assert.equal(b.claimNext("b"), null);
});

test("worker understands explicit retry transport results", async () => {
  const store = new FileMailStore();
  store.create(base);
  const worker = createOutboxWorker({ outbox: store, retryBaseMs: 1,
    transport: { async send() { return { status: "retry", error: "later" }; } } });
  await worker.tick();
  assert.equal(store.get("msg_1").status, "retrying");
});

test("MIME rejects header injection", () => {
  assert.throws(() => createMimeMessage({ ...base, from: "a@example.test", to: ["b@example.test"],
    subject: "hello\r\nBcc: victim@example.test", text: "x", html: "<b>x</b>" }),
  { code: "MAIL_INVALID_HEADER" });
});
