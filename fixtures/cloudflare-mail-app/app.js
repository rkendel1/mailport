import fs from "node:fs";
import { parseMailDsl } from "@mailerport/core";
import { createMailPort } from "@mailerport/sdk";
import { createCloudflareTransport } from "@mailerport/smtp";

const required = ["MAILPORT_CLOUDFLARE_ACCOUNT_ID", "MAILPORT_CLOUDFLARE_API_TOKEN", "TEST_RECIPIENT"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing end-to-end configuration: ${missing.join(", ")}`);
const contract = parseMailDsl(fs.readFileSync(new URL("./mail.config", import.meta.url), "utf8"));
console.log("✓ MailPort DSL");
const transport = createCloudflareTransport({ accountId: process.env.MAILPORT_CLOUDFLARE_ACCOUNT_ID,
  apiToken: process.env.MAILPORT_CLOUDFLARE_API_TOKEN, baseUrl: process.env.MAILPORT_CLOUDFLARE_BASE_URL });
const mail = createMailPort({ identities: contract.identities, transport });
console.log("✓ identity resolution");
const message = await mail.send({ identity: "auth", to: process.env.TEST_RECIPIENT,
  subject: "MailPort DSL proof", text: "MailPort Cloudflare transport works." });
if (message.status !== "accepted") {
  const failure = message.delivery?.error || {};
  throw new Error(`Cloudflare submission ${message.status}: ${failure.code || "MAIL_PROVIDER_REJECTED"}: ${failure.message || "submission rejected"}`);
}
console.log("✓ Cloudflare transport"); console.log("✓ provider acceptance");
if (!message.providerMessageId) throw new Error("Cloudflare did not return a provider message ID");
console.log("✓ provider message ID"); console.log("Check the real recipient inbox to confirm receipt.");
