import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { MailPortError, ERROR_CODES } from "@mailerport/core";

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
  const mime = lines.join("\r\n");
  if (!message.dkim?.privateKey) return mime;
  const split = mime.indexOf("\r\n\r\n");
  const body = mime.slice(split + 4).replace(/\r\n*$/, "\r\n");
  const bodyHash = crypto.createHash("sha256").update(body).digest("base64");
  const fields = lines.slice(0, lines.indexOf("")).filter((line) => /^(from|to|subject|date|message-id):/i.test(line));
  const unsigned = `v=1; a=rsa-sha256; c=simple/simple; d=${message.dkim.domain}; s=${message.dkim.selector}; h=from:to:subject:date:message-id; bh=${bodyHash}; b=`;
  const signingData = `${fields.join("\r\n")}\r\ndkim-signature:${unsigned}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingData), message.dkim.privateKey).toString("base64");
  return `DKIM-Signature: ${unsigned}${signature}\r\n${mime}`;
}
