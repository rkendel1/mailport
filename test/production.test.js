import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateProductionConfig, createMailPort, FileOperationsStore, createDeliveryEventSource } from "../src/index.js";

test("production configuration fails closed", () => {
  assert.throws(() => validateProductionConfig({ production: true }, {}), { code: "MAIL_NOT_CONFIGURED" });
  assert.throws(() => validateProductionConfig({ production: true, apiKey: "dev-key", outbox: { filePath: "/data/outbox.json" },
    transport: "local" }, {}), /Development API keys/);
  assert.doesNotThrow(() => validateProductionConfig({ production: true, apiKey: "production-secret",
    outbox: { filePath: "/data/outbox.json" }, transport: "local" }, {}));
});

test("hard bounce is authoritative and suppresses future mail", async () => {
  const outbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-delivery-")), "outbox.json");
  const mail = createMailPort({ applicationId: "a", identities: { system: "system@example.test" }, transport: "local",
    outbox: { filePath: outbox, pollIntervalMs: 5 }, testEndpointsEnabled: true });
  const operations = new FileOperationsStore();
  const accepted = await mail.send({ identity: "system", to: "bad@example.test", subject: "x", text: "x" });
  let sent;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    sent = mail.get(accepted.message_id); if (sent.status === "sent") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const source = createDeliveryEventSource({ mail, operations });
  const bounced = await source.consume({ type: "bounced", bounce_type: "hard", message_id: accepted.message_id,
    recipient: "bad@example.test" });
  assert.equal(bounced.status, "bounced");
  assert.equal(operations.isSuppressed("bad@example.test", { application_id: "a", tenant_id: null }).reason, "hard_bounce");
  assert.equal(bounced.events.some((event) => event.event_type === "message.delivered"), false);
  await mail.close();
});

test("DKIM private keys are not persisted in operational records", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-domain-")), "operations.json");
  const operations = new FileOperationsStore({ filePath });
  operations.createDomain("example.test");
  assert.equal(fs.readFileSync(filePath, "utf8").includes("PRIVATE KEY"), false);
});

test("DKIM private keys are not persisted in outbox messages", async () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-outbox-secret-")), "outbox.json");
  const mail = createMailPort({ identities: { system: "system@example.test" }, transport: "local",
    outbox: { filePath, workerEnabled: false } });
  await mail.send({ identity: "system", to: "user@example.test", subject: "x", text: "x",
    __dkim: { privateKey: "PRIVATE KEY MATERIAL", domain: "example.test", selector: "mp1" } });
  assert.equal(fs.readFileSync(filePath, "utf8").includes("PRIVATE KEY MATERIAL"), false);
  await mail.close();
});
