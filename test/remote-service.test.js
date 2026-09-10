import test from "node:test";
import assert from "node:assert/strict";
import { createMailPort } from "../src/mailport.js";
import { createMailPortService } from "../src/remote-service.js";

test("remote client talks to authenticated MailPort service", async () => {
  const serviceMail = createMailPort({
    applicationId: "authboundary",
    transport: "memory",
    testEndpointsEnabled: true,
    identities: { auth: "auth@authboundry.com" },
    outbox: { enabled: true, pollIntervalMs: 10 },
  });
  const service = createMailPortService(serviceMail, {
    host: "127.0.0.1",
    port: 8791,
    apiKey: "dev-key",
  });
  await service.start();

  try {
    const client = createMailPort({
      transport: "remote",
      remote: { baseUrl: "http://127.0.0.1:8791", apiKey: "dev-key" },
      testEndpointsEnabled: true,
    });

    const sent = await client.send({
      identity: "auth",
      to: "user@example.com",
      subject: "Verify",
      text: "Verify now",
    });
    assert.equal(sent.status, "queued");

    const delivered = await client.test.waitFor({
      to: "user@example.com",
      status: "sent",
      timeoutMs: 1000,
      intervalMs: 10,
    });
    assert.ok(delivered);
    assert.equal(delivered.message_id, sent.message_id);
    assert.equal((await client.get(sent.message_id)).message_id, sent.message_id);
    assert.equal((await client.list({ to: "user@example.com" })).length, 1);
  } finally {
    await service.stop();
  }
});

test("remote service enforces auth", async () => {
  const serviceMail = createMailPort({
    applicationId: "authboundary",
    transport: "memory",
    testEndpointsEnabled: true,
    identities: { auth: "auth@authboundry.com" },
  });
  const service = createMailPortService(serviceMail, {
    host: "127.0.0.1",
    port: 8792,
    apiKey: "dev-key",
  });
  await service.start();

  try {
    const client = createMailPort({
      transport: "remote",
      remote: { baseUrl: "http://127.0.0.1:8792", apiKey: "wrong-key" },
      testEndpointsEnabled: true,
    });

    await assert.rejects(
      () =>
        client.send({
          identity: "auth",
          to: "user@example.com",
          subject: "Verify",
          text: "Verify now",
        }),
      (error) => error.code === "MAIL_UNAUTHORIZED"
    );
  } finally {
    await service.stop();
  }
});
