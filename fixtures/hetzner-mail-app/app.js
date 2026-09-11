import fs from "node:fs";
import { parseMailDsl } from "@mailerport/core";
import { createMailPort } from "@mailerport/sdk";

const required = ["MAILPORT_URL", "MAILPORT_API_KEY", "TEST_RECIPIENT"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing end-to-end configuration: ${missing.join(", ")}`);
const contract = parseMailDsl(fs.readFileSync(new URL("./mail.config", import.meta.url), "utf8"));
console.log("✓ MailPort DSL");
const mail = createMailPort({ identities: contract.identities });
console.log("✓ identity resolution");
const service = await mail.status();
if (service.transport !== "direct-mx")
  throw new Error(`Expected deployed direct-mx transport, received ${service.transport || "unknown"}`);
console.log("✓ Hetzner direct-MX transport");
let message = await mail.send({ identity: "auth", to: process.env.TEST_RECIPIENT,
  subject: "MailPort Hetzner direct-MX proof", text: "MailPort Hetzner direct-MX transport works." });
console.log("✓ durable service submission");
const timeoutMs = Number(process.env.MAILPORT_E2E_TIMEOUT_MS || 60_000);
const deadline = Date.now() + timeoutMs;
while (["queued", "leased", "sending", "retrying"].includes(message.status) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  message = await mail.get(message.message_id);
}
if (message.status !== "accepted") {
  const reason = message.delivery?.error?.message || message.last_error || "delivery did not complete";
  throw new Error(`Hetzner direct-MX delivery ${message.status}: ${reason}`);
}
if (message.provider !== "direct-mx" || message.transport?.type !== "direct-mx")
  throw new Error("Delivery was accepted without direct-MX transport evidence");
console.log("✓ recipient MX accepted message");
console.log("✓ direct-MX evidence persisted");
console.log("Check the real recipient inbox to confirm receipt.");
