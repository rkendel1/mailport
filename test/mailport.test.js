import test from "node:test";
import assert from "node:assert/strict";
import { createMailPort } from "../src/mailport.js";

test("supports template send and idempotency", async () => {
  const mail = createMailPort({
    applicationId: "authboundry",
    transport: "memory",
    testEndpointsEnabled: true,
    identities: { auth: "auth@authboundry.com", system: "notifications@example.test" },
    templates: {
      "verify-email": {
        subject: "Verify your email",
        html: `<a href="{{verification_url}}">Verify</a>`,
        text: "Verify: {{verification_url}}",
      },
    },
  });

  const first = await mail.send("verify-email", {
    identity: "auth",
    to: "user@example.com",
    variables: { verification_url: "http://127.0.0.1:3000/verify/token123" },
    idempotencyKey: "verify:token123",
    metadata: { testRunId: "run-1" },
  });
  const second = await mail.send("verify-email", {
    identity: "auth",
    to: "user@example.com",
    variables: { verification_url: "http://127.0.0.1:3000/verify/token123" },
    idempotencyKey: "verify:token123",
  });

  assert.equal(first.message_id, second.message_id);
  assert.equal(first.status, "sent");
  assert.deepEqual(first.links, ["http://127.0.0.1:3000/verify/token123"]);
});

test("supports explicit send, list/get/clear, and waitFor", async () => {
  const mail = createMailPort({
    applicationId: "appboundry",
    transport: "memory",
    testEndpointsEnabled: true,
    identities: { system: "notifications@myapp.com" },
  });

  const msg = await mail.send({
    identity: "system",
    to: ["user@example.com"],
    subject: "Reset",
    text: "Reset link: /reset/token999",
  });

  const byList = mail.test.list({ to: "user@example.com", subject: "reset" });
  assert.equal(byList.length, 1);
  assert.equal(mail.test.get(msg.message_id).message_id, msg.message_id);
  assert.equal(byList[0].links[0], "/reset/token999");

  const waited = await mail.test.waitFor({
    to: "user@example.com",
    template: null,
    testRunId: undefined,
    timeoutMs: 1000,
  });
  assert.equal(waited.message_id, msg.message_id);

  mail.test.clear();
  assert.equal(mail.test.list().length, 0);
});

test("surfaces transport delivery errors", async () => {
  const mail = createMailPort({
    applicationId: "appboundry",
    transport: "smtp",
    testEndpointsEnabled: true,
    identities: { system: "notifications@myapp.com" },
  });

  await assert.rejects(
    () =>
      mail.send({
        identity: "system",
        to: "user@example.com",
        subject: "Hello",
        text: "Hi",
      }),
    (error) =>
      error.code === "MAIL_DELIVERY_FAILED" &&
      Boolean(error.details && error.details.message_id)
  );
});

test("waitFor returns null on timeout", async () => {
  const mail = createMailPort({
    applicationId: "appboundry",
    transport: "memory",
    testEndpointsEnabled: true,
    identities: { system: "notifications@myapp.com" },
  });

  const result = await mail.test.waitFor({
    to: "nobody@example.com",
    timeoutMs: 50,
    intervalMs: 10,
  });
  assert.equal(result, null);
});

test("waitFor resolves after delayed message arrival", async () => {
  const mail = createMailPort({
    applicationId: "appboundry",
    transport: "memory",
    testEndpointsEnabled: true,
    identities: { system: "notifications@myapp.com" },
  });

  setTimeout(() => {
    mail.send({
      identity: "system",
      to: "later@example.com",
      subject: "Delayed",
      text: "Delayed body",
    });
  }, 20);

  const result = await mail.test.waitFor({
    to: "later@example.com",
    timeoutMs: 1000,
    intervalMs: 10,
  });
  assert.equal(result.to[0], "later@example.com");
});

test("durable outbox retries and eventually marks sent", async () => {
  let attempts = 0;
  const mail = createMailPort({
    applicationId: "appboundry",
    transport: {
      kind: "custom",
      async send() {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("temporary failure");
        }
        return { status: "sent" };
      },
    },
    outbox: {
      enabled: true,
      pollIntervalMs: 10,
      retryBaseMs: 10,
      maxAttempts: 3,
    },
    testEndpointsEnabled: true,
    identities: { system: "notifications@myapp.com" },
  });

  const queued = await mail.send({
    identity: "system",
    to: "retry@example.com",
    subject: "Retry",
    text: "Retry body",
  });
  assert.equal(queued.status, "queued");

  const delivered = await mail.test.waitFor({
    to: "retry@example.com",
    status: "sent",
    timeoutMs: 1000,
    intervalMs: 10,
  });
  assert.ok(delivered);
  assert.equal(delivered.status, "sent");
  assert.equal(attempts, 2);
});
