import { randomUUID } from "node:crypto";
import { MailPortError, ERROR_CODES } from "./errors.js";

function header(value) {
  const text = String(value || "");
  if (/\r|\n/.test(text)) throw new MailPortError(ERROR_CODES.MAIL_INVALID_HEADER, "Mail header contains a newline");
  return text;
}
const addresses = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean).map(header).join(", ");
const encode = (value) => Buffer.from(value).toString("base64").replace(/(.{76})/g, "$1\r\n");

export function createMimeMessage(message) {
  const boundary = `mailport_${randomUUID().replaceAll("-", "")}`;
  const alternative = `${boundary}_alternative`;
  const lines = [
    `From: ${header(message.from)}`, `To: ${addresses(message.to)}`,
    ...(message.cc?.length ? [`Cc: ${addresses(message.cc)}`] : []),
    ...(message.reply_to?.length ? [`Reply-To: ${addresses(message.reply_to)}`] : []),
    `Subject: ${header(message.subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${header(message.message_id)}@mailport>`, "MIME-Version: 1.0",
  ];
  const attachments = message.attachments || [];
  const bodyBoundary = attachments.length ? alternative : boundary;
  lines.push(`Content-Type: multipart/${attachments.length ? "mixed" : "alternative"}; boundary="${boundary}"`, "");
  if (attachments.length) lines.push(`--${boundary}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, "");
  lines.push(`--${bodyBoundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", message.text || "",
    `--${bodyBoundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", message.html || "",
    `--${bodyBoundary}--`);
  for (const item of attachments) {
    const filename = header(item.filename || "attachment");
    lines.push(`--${boundary}`, `Content-Type: ${header(item.contentType || "application/octet-stream")}; name="${filename}"`,
      "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${filename}"`, "",
      encode(Buffer.isBuffer(item.content) ? item.content : Buffer.from(String(item.content || ""))));
  }
  if (attachments.length) lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}
