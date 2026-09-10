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
  if (missing.length) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, `Missing production configuration: ${missing.join(", ")}`);
  if (/^(dev|test)(-|$)/i.test(apiKey)) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, "Development API keys are forbidden in production");
  if (!path.isAbsolute(outbox)) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, "MAILPORT_OUTBOX must be an absolute persistent-storage path in production");
  return { production: true, outbox, transport };
}
