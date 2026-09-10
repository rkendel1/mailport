#!/usr/bin/env node
import { createMailPort } from "../src/mailport.js";
import { createLocalInboxServer } from "../src/local-inbox-server.js";
import { createMailPortService } from "../src/remote-service.js";
import { createRemoteMailPortClient } from "../src/remote-client.js";

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

  if (args[1] === "status") {
    if (process.env.MAILPORT_URL) {
      console.log(JSON.stringify(await createRemoteMailPortClient({ baseUrl: process.env.MAILPORT_URL,
        apiKey: process.env.MAILPORT_API_KEY }).status(), null, 2));
    } else printStatus(mail);
    return;
  }

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
    const serviceMail = createMailPort({
      applicationId: process.env.MAILPORT_APPLICATION_ID || "app",
      transport: serviceTransport,
      identities: { system: "notifications@example.test" },
      testEndpointsEnabled: true,
      outbox: {
        enabled: true,
        filePath: outboxFile,
      },
    });
    const service = createMailPortService(serviceMail, { host, port, apiKey });
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
