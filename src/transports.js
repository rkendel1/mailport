import net from "node:net";
import tls from "node:tls";
import { MailPortError, ERROR_CODES } from "./errors.js";
import { createMimeMessage } from "./mime.js";

export class MemoryTransport { constructor() { this.kind = "memory"; } async send() { return { status: "sent" }; } }
export class LocalTransport { constructor() { this.kind = "local"; } async send() { return { status: "sent" }; } }

function smtpCommand(socket, command, expected) {
  return new Promise((resolve, reject) => {
    let response = "";
    const onData = (chunk) => {
      response += chunk;
      const lines = response.split("\r\n").filter(Boolean);
      const last = lines.at(-1) || "";
      if (!/^\d{3} /.test(last)) return;
      cleanup();
      if (expected.includes(Number(last.slice(0, 3)))) resolve(response);
      else reject(new Error(`SMTP rejected command (${last.slice(0, 3)})`));
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
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    try {
      await smtpCommand(socket, null, [220]);
      await smtpCommand(socket, `EHLO ${this.options.helo || "mailport.local"}`, [250]);
      if (username) {
        await smtpCommand(socket, "AUTH LOGIN", [334]);
        await smtpCommand(socket, Buffer.from(username).toString("base64"), [334]);
        await smtpCommand(socket, Buffer.from(password || "").toString("base64"), [235]);
      }
      await smtpCommand(socket, `MAIL FROM:<${message.from}>`, [250]);
      for (const recipient of [...message.to, ...(message.cc || []), ...(message.bcc || [])])
        await smtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
      await smtpCommand(socket, "DATA", [354]);
      const mime = createMimeMessage(message).replace(/^\./gm, "..");
      await smtpCommand(socket, `${mime}\r\n.`, [250]);
      await smtpCommand(socket, "QUIT", [221]);
      return { status: "sent" };
    } catch (error) {
      throw new MailPortError(ERROR_CODES.MAIL_DELIVERY_FAILED, error.message);
    } finally { socket.destroy(); }
  }
}

export function createSmtpTransport(options) { return new SmtpTransport(options); }
