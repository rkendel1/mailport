import test from "node:test";
import assert from "node:assert/strict";
import { createMailPort } from "../src/mailport.js";
import { createLocalInboxServer } from "../src/local-inbox-server.js";

test("serves test inbox and test message API", async () => {
  const mail = createMailPort({
    applicationId: "authboundry",
    transport: "local",
    testEndpointsEnabled: true,
    identities: { system: "notifications@example.test" },
  });
  const server = createLocalInboxServer(mail, { host: "127.0.0.1", port: 8790 });
  await server.start();

  try {
    const sent = await mail.send({
      identity: "system",
      to: "test@example.com",
      subject: "Hello",
      text: "MailPort works.",
    });

    const apiRes = await fetch("http://127.0.0.1:8790/v1/test/messages");
    const messages = await apiRes.json();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message_id, sent.message_id);

    const inboxRes = await fetch("http://127.0.0.1:8790/mail");
    const inboxHtml = await inboxRes.text();
    assert.match(inboxHtml, /MailPort Test Inbox/);
    assert.match(inboxHtml, /Hello/);
    assert.match(inboxHtml, /\/mail\//);

    const detailRes = await fetch(`http://127.0.0.1:8790/mail/${sent.message_id}`);
    const detailHtml = await detailRes.text();
    assert.match(detailHtml, /MailPort works\./);
  } finally {
    await server.stop();
  }
});
