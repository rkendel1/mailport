import test from "node:test";
import assert from "node:assert/strict";
import { createDirectMxWorker } from "../packages/service/src/direct-mx-worker.js";
import { createRemoteDirectMxTransport } from "../src/index.js";

const jobMessage = { message_id: "msg_worker", attempt: 2, from: "auth@agenttrustvault.com", to: ["user@example.com"],
  cc: [], bcc: [], reply_to: [], subject: "Worker proof", text: "hello", html: "", headers: {}, attachments: [],
  tenant_id: "tenant", idempotencyKey: "key" };

async function runningWorker({ outcome = "accepted", token = "delivery-secret" } = {}) {
  const logs = [];
  const transport = { kind: "direct-mx", async send(message) { return { status: outcome === "accepted" ? "accepted" : outcome === "temporary_failure" ? "retry" : "failed",
    error: outcome === "accepted" ? undefined : "SMTP rejected", metadata: { evidence: [{ messageId: message.message_id,
      recipients: message.to, mxHost: "mx.example.com", mxAddress: "192.0.2.20", attempt: message.attempt, connection: "connected",
      tlsNegotiated: true, smtpCode: outcome === "accepted" ? 250 : outcome === "temporary_failure" ? 421 : 550,
      enhancedStatusCode: outcome === "accepted" ? "2.0.0" : null, response: "bounded", outcome, timestamp: new Date().toISOString() }] } }; } };
  const worker = createDirectMxWorker({ enabled: true, hostname: "mail.agenttrustvault.com", deliveryTokens: [token], port: 0,
    transport, signingKeyStore: { has: (domain) => domain === "agenttrustvault.com" }, logger: (entry) => logs.push(entry), warn() {},
    verifyOutbound: async ({ hostname, recipient }) => ({ hostname, egressIp: "192.0.2.10", ptr: true, forward: true, fcrdns: true,
      recipientDomain: recipient.split("@")[1], mxHost: "mx.example.com", outboundPort: 25, outboundReachable: true }) });
  await worker.start(); return { worker, token, logs, baseUrl: `http://127.0.0.1:${worker.server.address().port}` };
}

test("direct-MX worker exposes only health/readiness and authenticated delivery", async () => {
  const fixture = await runningWorker();
  try {
    assert.equal((await fetch(`${fixture.baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${fixture.baseUrl}/ready`)).status, 200);
    assert.equal((await fetch(`${fixture.baseUrl}/v1/deliver`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(`${fixture.baseUrl}/v1/messages`)).status, 404);
    assert.equal((await fetch(`${fixture.baseUrl}/v1/verify?to=user@example.com`)).status, 401);
    const verified = await fetch(`${fixture.baseUrl}/v1/verify?to=user@example.com`, { headers: { authorization: `Bearer ${fixture.token}` } });
    assert.equal(verified.status, 200); assert.equal((await verified.json()).verification.outboundReachable, true);
    const transport = createRemoteDirectMxTransport({ workerUrl: fixture.baseUrl, deliveryToken: fixture.token,
      signingResolver: async () => ({ domain: "agenttrustvault.com", selector: "mp1", privateKey: "must-not-cross-boundary" }) });
    const result = await transport.send(jobMessage);
    assert.equal(result.status, "accepted"); assert.equal(result.metadata.smtp.responseCode, 250);
    const serializedLogs = JSON.stringify(fixture.logs);
    assert.equal(serializedLogs.includes(fixture.token), false); assert.equal(serializedLogs.includes("hello"), false);
    assert.equal(serializedLogs.includes("must-not-cross-boundary"), false);
  } finally { await fixture.worker.stop(); }
});

test("direct-MX worker returns normalized temporary and permanent outcomes", async () => {
  for (const [outcome, expected] of [["temporary_failure", "retry"], ["permanent_failure", "failed"]]) {
    const fixture = await runningWorker({ outcome });
    try { const result = await createRemoteDirectMxTransport({ workerUrl: fixture.baseUrl, deliveryToken: fixture.token,
      signingResolver: async () => ({ domain: "agenttrustvault.com", selector: "mp1" }) }).send(jobMessage);
      assert.equal(result.status, expected); assert.equal(result.metadata.evidence[0].outcome, outcome);
    } finally { await fixture.worker.stop(); }
  }
});

test("direct-MX worker rejects unsafe startup and malformed jobs", async () => {
  assert.throws(() => createDirectMxWorker({ enabled: true, deliveryTokens: ["token"] }), /MAILPORT_MTA_HOSTNAME/);
  assert.throws(() => createDirectMxWorker({ enabled: true, hostname: "mail.example.com" }), /MAILPORT_DELIVERY_TOKEN/);
  assert.throws(() => createDirectMxWorker({ enabled: true, hostname: "mail.example.com", deliveryTokens: ["token"] }), /KEY_ENCRYPTION/);
  const fixture = await runningWorker();
  try { const response = await fetch(`${fixture.baseUrl}/v1/deliver`, { method: "POST",
    headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" }, body: "not json" });
    assert.equal(response.status, 400); assert.equal((await response.json()).error, "MAIL_DIRECT_MX_INVALID_JOB");
  } finally { await fixture.worker.stop(); }
});
