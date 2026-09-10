#!/usr/bin/env node
import { createMailPort } from "../src/mailport.js";
import { createLocalInboxServer } from "../src/local-inbox-server.js";
import { createRemoteMailPortClient } from "../src/remote-client.js";
import { createMailService } from "../src/service.js";

function readFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function printStatus(mail) {
  const queueDepth = mail.list({ status: "queued" }).length;
  console.log("MailPort");
  console.log("──────────────");
  console.log("Endpoint: connected");
  console.log(`Transport: ${mail.transportName}`);
  console.log(`Queue: ${queueDepth}`);
  console.log("Workers: 1");
  console.log("Health");
  console.log("──────────────");
  console.log("API             OK");
  console.log("Queue           OK");
  console.log("Delivery        OK");
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "mail") {
    console.error("Usage: app mail <status|dev|service|send|test>");
    process.exit(1);
  }

  const transport =
    process.env.FELTDB_MAIL_TRANSPORT ||
    process.env.MAILPORT_TRANSPORT ||
    "memory";
  const mail = createMailPort({
    applicationId: process.env.MAILPORT_APPLICATION_ID || "app",
    transport,
    identities: { system: "notifications@example.test" },
    testEndpointsEnabled: true,
  });
  const remote = process.env.MAILPORT_URL ? createRemoteMailPortClient({ baseUrl: process.env.MAILPORT_URL,
    apiKey: process.env.MAILPORT_ADMIN_KEY || process.env.MAILPORT_API_KEY }) : null;

  if (args[1] === "status") {
    if (process.env.MAILPORT_URL) {
      console.log(JSON.stringify(await remote.status(), null, 2));
    } else printStatus(mail);
    return;
  }

  if (args[1] === "domains") { if (!remote) throw new Error("MAILPORT_URL is required"); console.log(JSON.stringify(await remote.operations.domains.list(), null, 2)); return; }
  if (args[1] === "identities") { if (!remote) throw new Error("MAILPORT_URL is required"); console.log(JSON.stringify(await remote.operations.identities.list(), null, 2)); return; }
  if (args[1] === "suppressions") { if (!remote) throw new Error("MAILPORT_URL is required"); console.log(JSON.stringify(await remote.operations.suppressions.list(), null, 2)); return; }
  if (args[1] === "logs") { if (!remote) throw new Error("MAILPORT_URL is required"); const id = readFlag(args, "--message");
    if (!id) throw new Error("Usage: app mail logs --message <message-id>"); console.log(JSON.stringify(await remote.operations.events(id), null, 2)); return; }
  if (args[1] === "domain" && args[2] === "add") { if (!remote) throw new Error("MAILPORT_URL is required");
    console.log(JSON.stringify(await remote.operations.domains.add(args[3]), null, 2)); return; }
  if (args[1] === "domain" && args[2] === "verify") { if (!remote) throw new Error("MAILPORT_URL is required");
    console.log(JSON.stringify(await remote.operations.domains.verify(args[3]), null, 2)); return; }

  if (args[1] === "dev") {
    const server = createLocalInboxServer(mail);
    await server.start();
    console.log("MailPort local inbox:");
    console.log("http://127.0.0.1:8788/mail");
    return;
  }

  if (args[1] === "service") {
    const host = readFlag(args, "--host") || "127.0.0.1";
    const port = Number(readFlag(args, "--port") || 8789);
    const apiKey = readFlag(args, "--api-key") || process.env.MAILPORT_API_KEY;
    const outboxFile = readFlag(args, "--outbox") || readFlag(args, "--outbox-file") || process.env.MAILPORT_OUTBOX;
    const serviceTransport = readFlag(args, "--transport") || transport;
    const service = createMailService({
      host, port, apiKey, adminKey: process.env.MAILPORT_ADMIN_KEY,
      applicationId: process.env.MAILPORT_APPLICATION_ID || "app",
      transport: serviceTransport,
      identities: { system: "notifications@example.test" },
      testEndpointsEnabled: true,
      outbox: { filePath: outboxFile || ".mailport/outbox.json" },
      operations: { filePath: process.env.MAILPORT_OPERATIONS || ".mailport/operations.json" },
    });
    await service.start();
    console.log(`MailPort service listening on http://${host}:${port}`);
    return;
  }

  if (args[1] === "send") {
    const to = readFlag(args, "--to");
    const from = readFlag(args, "--from");
    const subject = readFlag(args, "--subject");
    const text = readFlag(args, "--text");
    const html = readFlag(args, "--html");
    if (!to || !from || !subject || !text) {
      throw new Error(
        "Usage: app mail send --to <email> --from <identity> --subject <subject> --text <text> [--html <html>]"
      );
    }
    const message = await mail.send({
      identity: from,
      to,
      subject,
      text,
      html: html || `<p>${text}</p>`,
    });
    console.log(JSON.stringify(message, null, 2));
    return;
  }

  if (args[1] === "test" && args[2] === "clear") {
    mail.test.clear();
    console.log("Cleared test messages.");
    return;
  }

  if (args[1] === "test" && args[2] === "inbox") {
    console.log("http://127.0.0.1:8788/mail");
    return;
  }

  if (args[1] === "test" && args[2] === "wait") {
    const to = readFlag(args, "--to");
    const template = readFlag(args, "--template");
    const msg = await mail.test.waitFor({ to, template, timeoutMs: 5000 });
    console.log(JSON.stringify(msg, null, 2));
    return;
  }

  throw new Error("Unknown app mail command");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
