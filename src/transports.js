import { MailPortError, ERROR_CODES } from "./errors.js";

export class MemoryTransport {
  constructor() {
    this.kind = "memory";
  }

  async send() {
    return { status: "sent" };
  }
}

export class LocalTransport {
  constructor() {
    this.kind = "local";
  }

  async send() {
    return { status: "sent" };
  }
}

export class SmtpTransport {
  constructor() {
    this.kind = "smtp";
  }

  async send() {
    throw new MailPortError(
      ERROR_CODES.MAIL_DELIVERY_FAILED,
      "SMTP transport is not configured in this minimal implementation"
    );
  }
}
