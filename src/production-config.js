import path from "node:path";
import { MailPortError, ERROR_CODES } from "./errors.js";

export function validateProductionConfig(options = {}, environment = process.env) {
  const production = options.production ?? environment.NODE_ENV === "production";
  if (!production) return { production: false };
  const apiKey = options.apiKey || environment.MAILPORT_API_KEY;
  const outbox = options.outbox?.filePath || environment.MAILPORT_OUTBOX;
  const transport = typeof options.transport === "string" ? options.transport : options.transport?.type || options.transport?.kind || environment.MAILPORT_TRANSPORT;
  const missing = [];
  if (!apiKey) missing.push("MAILPORT_API_KEY");
  if (!outbox) missing.push("MAILPORT_OUTBOX");
  if (!transport) missing.push("MAILPORT_TRANSPORT");
  if (transport === "smtp") {
    for (const name of ["MAILPORT_SMTP_HOST", "MAILPORT_SMTP_PORT", "MAILPORT_SMTP_USERNAME", "MAILPORT_SMTP_PASSWORD"])
      if (!environment[name] && !options.transport?.[name.slice(14).toLowerCase()]) missing.push(name);
  }
  if (transport === "direct-mx") {
    if (!environment.MAILPORT_MTA_HOSTNAME && !options.transport?.hostname) missing.push("MAILPORT_MTA_HOSTNAME");
    if (!environment.MAILPORT_EGRESS_IP && !options.transport?.egressIp) missing.push("MAILPORT_EGRESS_IP");
    if (!environment.MAILPORT_KEY_ENCRYPTION_KEY) missing.push("MAILPORT_KEY_ENCRYPTION_KEY");
  }
  if (transport === "cloudflare") {
    if (!environment.MAILPORT_CLOUDFLARE_ACCOUNT_ID && !options.transport?.accountId)
      throw new MailPortError("MAIL_CLOUDFLARE_ACCOUNT_ID_REQUIRED", "Cloudflare account ID is required");
    if (!environment.MAILPORT_CLOUDFLARE_API_TOKEN && !options.transport?.apiToken && !options.transport?.client)
      throw new MailPortError("MAIL_CLOUDFLARE_API_TOKEN_REQUIRED", "Cloudflare API token is required");
  }
  if (missing.length) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, `Missing production configuration: ${missing.join(", ")}`);
  if (/^(dev|test)(-|$)/i.test(apiKey)) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, "Development API keys are forbidden in production");
  if (!path.isAbsolute(outbox)) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, "MAILPORT_OUTBOX must be an absolute persistent-storage path in production");
  return { production: true, outbox, transport };
}
