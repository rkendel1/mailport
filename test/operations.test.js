import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMailService, FileOperationsStore } from "../src/index.js";

const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
  const { port } = server.address(); server.close(() => resolve(port)); }); });
const request = (port, token, pathname, options = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, {
  ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) } });

test("domains activate identities after DNS verification", async () => {
  const store = new FileOperationsStore();
  const domain = store.createDomain("example.test");
  store.createIdentity({ identity: "auth", address: "auth@example.test", application_id: "a" });
  store.resolver = { async resolveTxt(name) { return [[name === domain.spf.name ? domain.spf.record : domain.dkim.record]]; } };
  const verified = await store.verifyDomain("example.test");
  assert.equal(verified.status, "active");
  assert.equal(store.listIdentities({ application_id: "a" })[0].status, "active");
  assert.equal(Object.hasOwn(verified.dkim, "private_key"), false);
});

test("scoped keys isolate applications, suppression precedes acceptance, and limits return 429", async () => {
  const port = await freePort();
  const operations = new FileOperationsStore();
  operations.addKey({ token: "key-a", application_id: "a", scopes: ["mail.send", "mail.read", "mail.test"] });
  operations.addKey({ token: "key-b", application_id: "b", scopes: ["mail.send", "mail.read"] });
  const service = createMailService({ port, operationsStore: operations, adminKey: "admin", identities: { system: "system@example.test" },
    outbox: { filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-ops-")), "outbox.json") },
    transport: "local", testEndpointsEnabled: true, limits: { messagesPerMinute: 1 } });
  await service.start();
  try {
    const sent = await request(port, "key-a", "/v1/messages", { method: "POST", body: JSON.stringify({ identity: "system",
      to: "first@example.test", subject: "one", text: "one" }) });
    assert.equal(sent.status, 200); const message = await sent.json();
    assert.equal((await request(port, "key-b", `/v1/messages/${message.message_id}`)).status, 403);
    const limited = await request(port, "key-a", "/v1/messages", { method: "POST", body: JSON.stringify({ identity: "system",
      to: "second@example.test", subject: "two", text: "two" }) });
    assert.equal(limited.status, 429); assert.equal((await limited.json()).error, "MAIL_RATE_LIMITED");

    operations.addSuppression({ email: "blocked@example.test", application_id: "b", reason: "manual" });
    const blocked = await request(port, "key-b", "/v1/messages", { method: "POST", body: JSON.stringify({ identity: "system",
      to: "blocked@example.test", subject: "blocked", text: "blocked" }) });
    assert.equal((await blocked.json()).error, "MAIL_RECIPIENT_SUPPRESSED");
    assert.equal((await request(port, "key-b", "/v1/messages").then((item) => item.json())).length, 0);
    const events = await request(port, "key-a", `/v1/messages/${message.message_id}/events`).then((item) => item.json());
    assert.ok(events.some((event) => event.event_type === "message.accepted"));
    assert.equal(events.some((event) => event.event_type === "message.delivered"), false);
  } finally { await service.stop(); }
});
