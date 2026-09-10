import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import { createDirectMxTransport } from "@mailerport/smtp";
import { FileSigningKeyStore } from "./signing-key-store.js";
import { validateMtaIdentity } from "./mta-readiness.js";

const sendJson = (res, status, body) => { const value = JSON.stringify(body); res.writeHead(status,
  { "content-type": "application/json", "content-length": Buffer.byteLength(value) }); res.end(value); };
const digest = (value) => crypto.createHash("sha256").update(String(value || "")).digest();
const authorized = (header, tokens) => { const match = /^Bearer\s+(.+)$/i.exec(header || ""); if (!match) return false;
  const candidate = digest(match[1]); return tokens.some((token) => crypto.timingSafeEqual(candidate, digest(token))); };
const validEmail = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value) && value.length <= 320;
const validText = (value, limit) => typeof value === "string" && value.length <= limit && !/[\r\n]/.test(value);
const sameAddresses = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const withTimeout = (promise, ms, message) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms); timer.unref();
})]);

async function verifyOutbound({ hostname, egressIp, recipient, resolver = dns, timeoutMs = 10_000, port = 25 }) {
  const identity = await validateMtaIdentity({ hostname, egressIp, resolver });
  const domain = String(recipient || "").split("@").at(-1);
  if (!domain) throw new Error("A recipient address is required");
  const records = (await withTimeout(resolver.resolveMx(domain), timeoutMs, "MX lookup timed out"))
    .sort((a, b) => a.priority - b.priority);
  if (!records.length) throw new Error(`No MX records found for ${domain}`);
  const mxHost = records[0].exchange;
  await new Promise((resolve, reject) => { const socket = net.connect({ host: mxHost, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Outbound SMTP connection timed out")); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); }); });
  return { ...identity, recipientDomain: domain, mxHost, outboundPort: port, outboundReachable: true };
}

export function createDirectMxWorker(options = {}) {
  const environment = options.environment || process.env;
  if (environment.MAILPORT_DIRECT_MX_ENABLED !== "true" && options.enabled !== true) throw new Error("MAILPORT_DIRECT_MX_ENABLED must be true");
  const hostname = options.hostname || environment.MAILPORT_MTA_HOSTNAME;
  if (!hostname) throw new Error("MAILPORT_MTA_HOSTNAME is required");
  const tokens = options.deliveryTokens || [environment.MAILPORT_DELIVERY_TOKEN, environment.MAILPORT_DELIVERY_TOKEN_PREVIOUS].filter(Boolean);
  if (!tokens.length) throw new Error("MAILPORT_DELIVERY_TOKEN is required");
  const maxBodyBytes = Number(options.maxBodyBytes || environment.MAILPORT_DIRECT_MX_MAX_BODY_BYTES || 6 * 1024 * 1024);
  const maxRecipients = Number(options.maxRecipients || environment.MAILPORT_DIRECT_MX_MAX_RECIPIENTS || 50);
  const signingKeyStore = options.signingKeyStore || (environment.MAILPORT_KEY_ENCRYPTION_KEY ? new FileSigningKeyStore({
    filePath: environment.MAILPORT_SIGNING_KEYS || "/data/signing-keys.json", encryptionKey: environment.MAILPORT_KEY_ENCRYPTION_KEY }) : null);
  if (!signingKeyStore) throw new Error("MAILPORT_KEY_ENCRYPTION_KEY is required");
  const logger = options.logger || ((entry) => console.log(JSON.stringify(entry)));
  const transport = options.transport || createDirectMxTransport({ hostname, port: Number(environment.MAILPORT_DIRECT_MX_PORT || 25),
    requireTLS: environment.MAILPORT_MTA_REQUIRE_TLS === "true", timeoutMs: Number(environment.MAILPORT_DIRECT_MX_TIMEOUT_MS || 30_000),
    resolver: options.resolver, signingResolver: async (message) => { const signing = message.signing;
      const privateKey = signing && signingKeyStore?.get(signing.domain); return privateKey ? { ...signing, privateKey } : null; } });
  let ready = false;
  let identityStatus = null;
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") return sendJson(res, 200, { ok: true });
    if (req.method === "GET" && req.url === "/ready") return sendJson(res, ready ? 200 : 503, { ready });
    if (req.method === "GET" && req.url?.startsWith("/v1/verify")) {
      if (!authorized(req.headers.authorization, tokens)) return sendJson(res, 401, { error: "MAIL_DIRECT_MX_UNAUTHORIZED", message: "Unauthorized" });
      const recipient = new URL(req.url, "http://worker").searchParams.get("to");
      if (!validEmail(recipient)) return sendJson(res, 400, { error: "MAIL_DIRECT_MX_INVALID_RECIPIENT", message: "A valid recipient is required" });
      return (options.verifyOutbound || verifyOutbound)({ hostname, egressIp: options.egressIp || environment.MAILPORT_EGRESS_IP, recipient,
        resolver: options.identityResolver || dns, timeoutMs: Number(environment.MAILPORT_DIRECT_MX_TIMEOUT_MS || 10_000),
        port: Number(environment.MAILPORT_DIRECT_MX_PORT || 25) })
        .then((verification) => sendJson(res, 200, { ready, enabled: true, verification }))
        .catch((error) => sendJson(res, 503, { ready: false, enabled: true,
          error: "MAIL_DIRECT_MX_VERIFY_FAILED", message: String(error.message || error).slice(0, 512) }));
    }
    if (req.method !== "POST" || req.url !== "/v1/deliver") return sendJson(res, 404, { error: "MAIL_DIRECT_MX_NOT_FOUND", message: "Not found" });
    if (!authorized(req.headers.authorization, tokens)) return sendJson(res, 401, { error: "MAIL_DIRECT_MX_UNAUTHORIZED", message: "Unauthorized" });
    let size = 0, body = "", stopped = false;
    req.on("data", (chunk) => { if (stopped) return; size += chunk.length;
      if (size > maxBodyBytes) { stopped = true; sendJson(res, 413, { error: "MAIL_DIRECT_MX_JOB_TOO_LARGE", message: "Delivery job exceeds limit" }); req.destroy(); }
      else body += chunk; });
    req.on("end", async () => { if (stopped) return; let job; try { job = JSON.parse(body); }
      catch { return sendJson(res, 400, { error: "MAIL_DIRECT_MX_INVALID_JOB", message: "Malformed JSON" }); }
      const recipients = job?.envelope?.to;
      const messageRecipients = [...(job?.message?.to || []), ...(job?.message?.cc || []), ...(job?.message?.bcc || [])];
      const senderDomain = String(job?.envelope?.from || "").split("@").at(-1)?.toLowerCase();
      const headers = job?.message?.headers;
      const attachments = job?.message?.attachments;
      if (job?.version !== 1 || typeof job.messageId !== "string" || job.messageId.length > 200 || !validEmail(job?.envelope?.from) ||
          !Array.isArray(recipients) || !recipients.length || recipients.length > maxRecipients || !recipients.every(validEmail) ||
          job?.message?.from !== job.envelope.from || !Array.isArray(job?.message?.to) || !messageRecipients.every(validEmail) ||
          !sameAddresses(recipients, messageRecipients) || !validText(job?.message?.subject, 998) || (!job.message.text && !job.message.html) ||
          (headers && (typeof headers !== "object" || Array.isArray(headers) || Object.entries(headers).some(([key, value]) => !validText(key, 200) || !validText(value, 4096)))) ||
          (attachments && (!Array.isArray(attachments) || attachments.length > 50 || attachments.some((item) => !item || typeof item.contentBase64 !== "string"))))
        return sendJson(res, 400, { error: "MAIL_DIRECT_MX_INVALID_JOB", message: "Invalid delivery job" });
      if (job.signing?.domain?.toLowerCase() !== senderDomain || !validText(job.signing?.selector, 100) || !signingKeyStore.has(job.signing.domain))
        return sendJson(res, 422, { error: "MAIL_DIRECT_MX_SIGNING_KEY_UNAVAILABLE", message: "Signing key unavailable" });
      const decodedAttachments = (job.message.attachments || []).map((item) => ({ ...item, content: Buffer.from(item.contentBase64, "base64") }));
      const message = { message_id: job.messageId, attempt: Number(job.attempt) || 1, from: job.message.from || job.envelope.from,
        to: job.message.to || recipients, cc: job.message.cc || [], bcc: job.message.bcc || [], reply_to: job.message.replyTo || [],
        subject: job.message.subject, text: job.message.text || "", html: job.message.html || "", headers: job.message.headers || {},
        attachments: decodedAttachments, signing: job.signing };
      logger({ event: "direct-mx delivery started", message_id: job.messageId, recipients: recipients.length, attempt: message.attempt,
        timestamp: new Date().toISOString() });
      try { const result = await transport.send(message); const evidence = result.metadata?.evidence || []; const final = evidence.at(-1) || {};
        const outcome = result.status === "accepted" ? "accepted" : result.status === "retry" ? "temporary_failure" : "permanent_failure";
        logger({ event: `direct-mx delivery ${outcome}`, message_id: job.messageId, recipient: final.recipients?.[0] || null,
          mx: final.mxHost || null, smtp_code: final.smtpCode || null, retryable: outcome === "temporary_failure", timestamp: new Date().toISOString() });
        return sendJson(res, 200, { messageId: job.messageId, outcome, retryable: outcome === "temporary_failure",
          recipient: final.recipients?.[0] || null, smtp: final.mxHost ? { host: final.mxHost, port: Number(environment.MAILPORT_DIRECT_MX_PORT || 25),
            responseCode: final.smtpCode || null, enhancedStatusCode: final.enhancedStatusCode || null, response: final.response || null } : undefined,
          evidence, ...(result.error ? { error: { code: "MAIL_DIRECT_MX_DELIVERY_FAILED", message: String(result.error).slice(0, 512) } } : {}) });
      } catch { logger({ event: "direct-mx delivery temporary_failure", message_id: job.messageId, retryable: true, timestamp: new Date().toISOString() });
        return sendJson(res, 200, { messageId: job.messageId, outcome: "temporary_failure", retryable: true,
          error: { code: "MAIL_DIRECT_MX_DELIVERY_FAILED", message: "Direct-MX delivery failed" } }); }
    });
  });
  return { server, async start() { const egressIp = options.egressIp || environment.MAILPORT_EGRESS_IP;
    if (egressIp) identityStatus = await validateMtaIdentity({ hostname, egressIp, resolver: options.identityResolver });
    else (options.warn || console.warn)("MAILPORT_EGRESS_IP is not set; FCrDNS startup verification skipped");
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? (Number(environment.PORT) || 8799),
      options.host || environment.HOST || "0.0.0.0", resolve); }); ready = true; },
    async stop() { ready = false; if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
    get ready() { return ready; }, get identityStatus() { return identityStatus; } };
}
