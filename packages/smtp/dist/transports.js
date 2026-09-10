import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";
import { MailPortError, ERROR_CODES } from "@mailerport/core";
import { createMimeMessage } from "@mailerport/mime";

export class MemoryTransport { constructor() { this.kind = "memory"; } async send() { return { status: "sent", transport: "memory" }; } }
export class LocalTransport { constructor() { this.kind = "local"; } async send() { return { status: "sent", transport: "local" }; } }

function smtpCommand(socket, command, expected) {
  return new Promise((resolve, reject) => {
    let response = "";
    const onData = (chunk) => {
      response += chunk;
      if (response.length > 65_536) { cleanup(); return reject(new Error("SMTP response exceeded limit")); }
      const lines = response.split("\r\n").filter(Boolean);
      const last = lines.at(-1) || "";
      if (!/^\d{3} /.test(last)) return;
      cleanup();
      if (expected.includes(Number(last.slice(0, 3)))) resolve(response);
      else { const error = new Error(`SMTP rejected command (${last.slice(0, 3)})`); error.smtpCode = Number(last.slice(0, 3));
        error.enhancedStatusCode = last.match(/\b[245]\.\d\.\d\b/)?.[0]; error.smtpResponse = last.slice(0, 512); reject(error); }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => { socket.off("data", onData); socket.off("error", onError); };
    socket.on("data", onData); socket.on("error", onError);
    if (command !== null) socket.write(`${command}\r\n`);
  });
}

export class SmtpTransport {
  constructor(options = {}) { this.kind = "smtp"; this.options = options; }
  async send(message) {
    const { host, port = this.options.secure ? 465 : 25, secure = false, username, password } = this.options;
    if (!host) throw new MailPortError(ERROR_CODES.MAIL_DELIVERY_FAILED, "SMTP host is required");
    let socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    try {
      await smtpCommand(socket, null, [220]);
      let capabilities = await smtpCommand(socket, `EHLO ${this.options.helo || "mailport.local"}`, [250]);
      if (!secure && /STARTTLS/i.test(capabilities)) {
        await smtpCommand(socket, "STARTTLS", [220]);
        socket = await new Promise((resolve, reject) => {
          const secured = tls.connect({ socket, servername: host }, () => resolve(secured)); secured.once("error", reject);
        });
        capabilities = await smtpCommand(socket, `EHLO ${this.options.helo || "mailport.local"}`, [250]);
      } else if (!secure && this.options.requireTLS) {
        throw new Error("SMTP server does not advertise STARTTLS");
      }
      if (username) {
        await smtpCommand(socket, "AUTH LOGIN", [334]);
        await smtpCommand(socket, Buffer.from(username).toString("base64"), [334]);
        await smtpCommand(socket, Buffer.from(password || "").toString("base64"), [235]);
      }
      await smtpCommand(socket, `MAIL FROM:<${message.from}>`, [250]);
      for (const recipient of [...message.to, ...(message.cc || []), ...(message.bcc || [])])
        await smtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
      await smtpCommand(socket, "DATA", [354]);
      const dkim = await this.options.signingResolver?.(message);
      const mime = createMimeMessage({ ...message, dkim }).replace(/^\./gm, "..");
      await smtpCommand(socket, `${mime}\r\n.`, [250]);
      await smtpCommand(socket, "QUIT", [221]);
      return { status: "sent", transport: "smtp", message_id: `<${message.message_id}@mailport>` };
    } catch (error) {
      throw new MailPortError(ERROR_CODES.MAIL_DELIVERY_FAILED, error.message);
    } finally { socket.destroy(); }
  }
}

export function createSmtpTransport(options) { return new SmtpTransport(options); }

async function withTimeout(promise, timeoutMs, message) { let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]); }
  finally { clearTimeout(timer); } }

async function connectMx({ host, port, helo, envelopeFrom, recipients, mime, requireTLS, timeoutMs }) {
  let socket = net.connect({ host, port }); socket.setTimeout(timeoutMs, () => socket.destroy(new Error("SMTP connection timed out")));
  let tlsNegotiated = false;
  try {
    await smtpCommand(socket, null, [220]);
    let capabilities = await smtpCommand(socket, `EHLO ${helo}`, [250]);
    if (/STARTTLS/i.test(capabilities)) {
      await smtpCommand(socket, "STARTTLS", [220]);
      socket = await new Promise((resolve, reject) => { const secured = tls.connect({ socket, servername: host }, () => resolve(secured)); secured.once("error", reject); });
      tlsNegotiated = true;
      await smtpCommand(socket, `EHLO ${helo}`, [250]);
    } else if (requireTLS) throw new Error("Recipient MX does not advertise STARTTLS");
    await smtpCommand(socket, `MAIL FROM:<${envelopeFrom}>`, [250]);
    for (const recipient of recipients) await smtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    await smtpCommand(socket, "DATA", [354]);
    const accepted = await smtpCommand(socket, `${mime.replace(/^\./gm, "..")}\r\n.`, [250]);
    await smtpCommand(socket, "QUIT", [221]);
    const line = accepted.trim().split("\r\n").at(-1) || "250";
    return { tlsNegotiated, responseCode: Number(line.slice(0, 3)), enhancedStatusCode: line.match(/\b[245]\.\d\.\d\b/)?.[0], response: line.slice(0, 512) };
  } finally { socket.destroy(); }
}

export class DirectMxTransport {
  constructor({ hostname, envelopeFrom, port = 25, requireTLS = false, timeoutMs = 30_000, resolver = dns, signingResolver } = {}) {
    this.kind = "direct-mx"; this.hostname = hostname; this.envelopeFrom = envelopeFrom; this.port = port;
    this.requireTLS = requireTLS; this.timeoutMs = timeoutMs; this.resolver = resolver; this.signingResolver = signingResolver;
  }
  async send(message) {
    if (!this.hostname) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, "MAILPORT_MTA_HOSTNAME is required");
    const recipients = [...message.to, ...(message.cc || []), ...(message.bcc || [])];
    const groups = new Map();
    for (const recipient of recipients) { const domain = String(recipient).split("@").at(-1)?.toLowerCase();
      if (!domain) return { status: "failed", error: "Invalid recipient domain" };
      groups.set(domain, [...(groups.get(domain) || []), recipient]); }
    const dkim = await this.signingResolver?.(message);
    const mime = createMimeMessage({ ...message, dkim }); let deliveredGroups = 0; const errors = []; const evidence = [];
    for (const [domain, domainRecipients] of groups) {
      let exchanges;
      try { exchanges = (await withTimeout(this.resolver.resolveMx(domain), this.timeoutMs, "MX lookup timed out")).sort((a, b) => a.priority - b.priority); }
      catch (error) { errors.push(error); continue; }
      let accepted = false;
      for (const exchange of exchanges) {
        const startedAt = new Date().toISOString(); let mxAddress = null; try { mxAddress = (await dns.lookup(exchange.exchange)).address; } catch {}
        try { const smtp = await connectMx({ host: exchange.exchange, port: this.port, helo: this.hostname,
          envelopeFrom: this.envelopeFrom || message.from, recipients: domainRecipients, mime,
          requireTLS: this.requireTLS, timeoutMs: this.timeoutMs }); evidence.push({ messageId: message.message_id, recipients: domainRecipients,
          mxHost: exchange.exchange, mxAddress, attempt: message.attempt || 1, connection: "connected", tlsNegotiated: smtp.tlsNegotiated,
          smtpCode: smtp.responseCode, enhancedStatusCode: smtp.enhancedStatusCode || null, response: smtp.response, outcome: "accepted", timestamp: startedAt }); accepted = true; break; }
        catch (error) { errors.push(error); evidence.push({ messageId: message.message_id, recipients: domainRecipients, mxHost: exchange.exchange,
          mxAddress, attempt: message.attempt || 1, connection: "failed", tlsNegotiated: false, smtpCode: error.smtpCode || null,
          enhancedStatusCode: error.enhancedStatusCode || null, response: error.smtpResponse || error.message.slice(0, 512),
          outcome: error.smtpCode >= 500 ? "permanent_failure" : "temporary_failure", timestamp: startedAt }); if (error.smtpCode >= 500) break; }
      }
      if (accepted) deliveredGroups += 1;
    }
    if (deliveredGroups === groups.size) return { status: "accepted", transport: "direct-mx", message_id: `<${message.message_id}@${this.hostname}>`, metadata: { evidence } };
    const permanent = errors.some((error) => error.smtpCode >= 500);
    return { status: deliveredGroups ? "failed" : permanent ? "failed" : "retry",
      error: errors.at(-1)?.message || "No recipient MX accepted the message", metadata: { delivered_groups: deliveredGroups, total_groups: groups.size, evidence } };
  }
}

export function createDirectMxTransport(options) { return new DirectMxTransport(options); }
