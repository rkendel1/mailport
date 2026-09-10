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
