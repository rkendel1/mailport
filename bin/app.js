#!/usr/bin/env node
import { createMailService } from "@mailerport/service";

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

function printTransportStatus(status = {}) {
  const transport = status.transport || process.env.MAILPORT_TRANSPORT || process.env.FELTDB_MAIL_TRANSPORT || "memory";
  console.log("MailPort transport"); console.log(`Transport: ${transport}`);
  if (transport === "cloudflare") {
    console.log(`Status: ${process.env.MAILPORT_CLOUDFLARE_ACCOUNT_ID && process.env.MAILPORT_CLOUDFLARE_API_TOKEN ? "configured" : "not configured"}`);
    console.log(`Account: ${process.env.MAILPORT_CLOUDFLARE_ACCOUNT_ID ? "********" : "missing"}`);
    console.log(`API token: ${process.env.MAILPORT_CLOUDFLARE_API_TOKEN ? "configured" : "missing"}`);
  } else console.log("Status: configured");
}

function printDomain(domain) {
  console.log("MailPort Domain"); console.log(domain.domain); console.log(`Status: ${domain.status.toUpperCase()}`);
  for (const [label, status] of [["Domain ownership", domain.verification?.status], ["DKIM", domain.authentication?.dkim],
    ["SPF", domain.authentication?.spf], ["DMARC", domain.authentication?.dmarc]])
    console.log(`${status === "verified" ? "✓" : "○"} ${label}`);
}
function printDns(domain, records) {
  printDomain(domain); console.log("DNS records:");
  for (const record of records) console.log(`${record.type.padEnd(6)} ${record.name}\n       ${record.value}`);
  console.log(`Run:\n  app mail domain verify ${domain.domain}`);
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
  let sdk;
  const getSdk = async () => {
    if (sdk) return sdk;
    sdk = await import("@mailerport/sdk");
    return sdk;
  };
  let mail;
  const getMail = async () => {
    if (mail) return mail;
    const { createMailPort } = await getSdk();
    mail = createMailPort({
      applicationId: process.env.MAILPORT_APPLICATION_ID || "app",
      transport,
      identities: { system: "notifications@example.test" },
      testEndpointsEnabled: true,
    });
    return mail;
  };
  let remote;
  const getRemote = async () => {
    if (!process.env.MAILPORT_URL) return null;
    if (remote) return remote;
    const { createRemoteMailPortClient } = await getSdk();
    remote = createRemoteMailPortClient({ baseUrl: process.env.MAILPORT_URL,
      apiKey: process.env.MAILPORT_ADMIN_KEY || process.env.MAILPORT_API_KEY });
    return remote;
  };

  if (args[1] === "status") {
    if (process.env.MAILPORT_URL) {
      const remote = await getRemote();
      console.log(JSON.stringify(await remote.status(), null, 2));
    } else printStatus(await getMail());
    return;
  }

  if (args[1] === "transport" && args[2] === "status") {
    printTransportStatus(process.env.MAILPORT_URL ? await (await getRemote()).status() : { transport });
    return;
  }

  if (args[1] === "domains") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required"); console.log(JSON.stringify(await remote.operations.domains.list(), null, 2)); return; }
  if (args[1] === "identities") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required"); console.log(JSON.stringify(await remote.operations.identities.list(), null, 2)); return; }
  if (args[1] === "suppressions") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required"); console.log(JSON.stringify(await remote.operations.suppressions.list(), null, 2)); return; }
  if (args[1] === "logs") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required"); const id = readFlag(args, "--message");
    if (!id) throw new Error("Usage: app mail logs --message <message-id>"); console.log(JSON.stringify(await remote.operations.events(id), null, 2)); return; }
  if (args[1] === "domain" && args[2] === "add") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required");
    const domain = await remote.operations.domains.add(args[3]); printDns(domain, domain.dns); return; }
  if (args[1] === "domain" && args[2] === "status") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required");
    printDomain(await remote.operations.domains.get(args[3])); return; }
  if (args[1] === "domain" && args[2] === "dns") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required");
    const domain = await remote.operations.domains.get(args[3]); printDns(domain, await remote.operations.domains.dns(args[3])); return; }
  if (args[1] === "domain" && args[2] === "verify") { const remote = await getRemote(); if (!remote) throw new Error("MAILPORT_URL is required");
    printDomain(await remote.operations.domains.verify(args[3])); return; }

  if (args[1] === "dev") {
    const { createLocalInboxServer } = await import("../src/local-inbox-server.js");
    const server = createLocalInboxServer(await getMail());
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
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return; shuttingDown = true;
      const timeout = setTimeout(() => process.exit(1), Number(process.env.MAILPORT_SHUTDOWN_TIMEOUT_MS || 30_000));
      timeout.unref();
      try { await service.stop(); process.exit(0); } catch { process.exit(1); }
    };
    process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
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
    const target = await getRemote() || await getMail();
    const message = await target.send({
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
    (await getMail()).test.clear();
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
    const msg = await (await getMail()).test.waitFor({ to, template, timeoutMs: 5000 });
    console.log(JSON.stringify(msg, null, 2));
    return;
  }

  throw new Error("Unknown app mail command");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
