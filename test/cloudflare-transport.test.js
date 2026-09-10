import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CloudflareEmailHttpClient, FakeCloudflareEmailClient, createCloudflareTransport,
  createMailPort, createMailService, ERROR_CODES, MailPortError, validateProductionConfig } from "../src/index.js";

const message = { message_id: "msg_cf", from: "auth@agenttrustvault.com", to: ["user@example.com"], cc: [], bcc: [],
  reply_to: [], subject: "Verify", html: "<p>Verify</p>", text: "Verify", headers: {}, attachments: [] };

test("Cloudflare transport maps a normalized request and provider acceptance", async () => {
  const client = new FakeCloudflareEmailClient({ response: { success: true, messageId: "cf_123" } });
  const result = await createCloudflareTransport({ accountId: "account", client }).send(message);
  assert.deepEqual(client.requests[0], { to: "user@example.com", from: "auth@agenttrustvault.com", subject: "Verify",
    html: "<p>Verify</p>", text: "Verify" });
  assert.deepEqual(result, { status: "accepted", transport: "cloudflare", provider: "cloudflare",
    providerMessageId: "cf_123", message_id: "cf_123" });
});

test("Cloudflare HTTP client uses the account endpoint without serializing its token", async () => {
  let call;
  const client = new CloudflareEmailHttpClient({ accountId: "acct/id", apiToken: "super-secret-token", fetcher: async (url, options) => {
    call = { url, options }; return new Response(JSON.stringify({ success: true, result: { message_id: "cf_http", queued: [], delivered: [] } }),
      { status: 200, headers: { "content-type": "application/json" } }); } });
  assert.equal((await client.send({ to: "a@example.com" })).messageId, "cf_http");
  assert.match(call.url, /accounts\/acct%2Fid\/email\/sending\/send$/);
  assert.equal(call.options.headers.authorization, "Bearer super-secret-token");
  assert.equal(JSON.stringify(client).includes("super-secret-token"), false);
});

test("Cloudflare HTTP failures classify authentication, throttling, server, and network errors", async () => {
  const cases = [[401, ERROR_CODES.MAIL_PROVIDER_AUTH_FAILED, "failed"], [429, ERROR_CODES.MAIL_PROVIDER_RATE_LIMITED, "retry"],
    [500, ERROR_CODES.MAIL_PROVIDER_UNAVAILABLE, "retry"]];
  for (const [status, code, expected] of cases) {
    const fetcher = async () => new Response(JSON.stringify({ success: false, errors: [{ message: "safe failure" }] }),
      { status, headers: { "content-type": "application/json" } });
    const result = await createCloudflareTransport({ accountId: "account", apiToken: "token-value", fetcher }).send(message);
    assert.equal(result.status, expected); assert.equal(result.error.code, code); assert.equal(JSON.stringify(result).includes("token-value"), false);
  }
  const network = await createCloudflareTransport({ accountId: "account", apiToken: "token-value",
    fetcher: async () => { throw new Error("request failed with token-value"); } }).send(message);
  assert.equal(network.status, "retry"); assert.equal(network.error.code, ERROR_CODES.MAIL_PROVIDER_UNAVAILABLE);
  assert.equal(JSON.stringify(network).includes("token-value"), false);
});

test("Cloudflare provider failures normalize retry and permanent classifications without credential leakage", async () => {
  const cases = [[ERROR_CODES.MAIL_PROVIDER_AUTH_FAILED, false], [ERROR_CODES.MAIL_PROVIDER_NOT_ENTITLED, false],
    [ERROR_CODES.MAIL_PROVIDER_SENDING_DISABLED, false], [ERROR_CODES.MAIL_PROVIDER_REJECTED, false],
    [ERROR_CODES.MAIL_PROVIDER_RATE_LIMITED, true], [ERROR_CODES.MAIL_PROVIDER_UNAVAILABLE, true]];
  for (const [code, retryable] of cases) {
    const error = new MailPortError(code, `safe ${code}`, { retryable });
    const result = await createCloudflareTransport({ accountId: "account", client: new FakeCloudflareEmailClient({ error }) }).send(message);
    assert.equal(result.status, retryable ? "retry" : "failed"); assert.equal(result.error.code, code);
    assert.equal(JSON.stringify(result).includes("token-value"), false);
  }
});

test("Cloudflare production configuration fails closed with machine-readable credential errors", () => {
  const base = { NODE_ENV: "production", MAILPORT_API_KEY: "production-key", MAILPORT_OUTBOX: "/data/outbox.json", MAILPORT_TRANSPORT: "cloudflare" };
  assert.throws(() => validateProductionConfig({}, base), { code: "MAIL_CLOUDFLARE_ACCOUNT_ID_REQUIRED" });
  assert.throws(() => validateProductionConfig({}, { ...base, MAILPORT_CLOUDFLARE_ACCOUNT_ID: "account" }),
    { code: "MAIL_CLOUDFLARE_API_TOKEN_REQUIRED" });
});

test("Cloudflare acceptance and provider ID persist while MailPort owns idempotency", async () => {
  const client = new FakeCloudflareEmailClient({ response: { success: true, messageId: "cf_once" } });
  const transport = createCloudflareTransport({ accountId: "account", client });
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-cf-")), "outbox.json");
  const mail = createMailPort({ identities: { auth: "auth@agenttrustvault.com" }, transport,
    outbox: { enabled: true, filePath, pollIntervalMs: 5, retryBaseMs: 5 } });
  const payload = { identity: "auth", to: "user@example.com", subject: "Verify", text: "Verify", idempotencyKey: "signup-123" };
  const first = await mail.send(payload); const second = await mail.send(payload);
  assert.equal(first.message_id, second.message_id);
  let stored; for (let i = 0; i < 100; i += 1) { stored = mail.get(first.message_id); if (stored.status === "accepted") break;
    await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.equal(stored.status, "accepted"); assert.equal(stored.provider, "cloudflare"); assert.equal(stored.providerMessageId, "cf_once");
  assert.equal(client.requests.length, 1); await mail.close();
});

test("service configuration redacts Cloudflare credentials", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-cf-config-"));
  const service = createMailService({ production: true, apiKey: "production-api-key", outbox: { filePath: path.join(directory, "outbox.json") },
    operations: { filePath: path.join(directory, "operations.json") }, transport: { type: "cloudflare", accountId: "account",
      apiToken: "credential-must-not-serialize", client: new FakeCloudflareEmailClient() } });
  assert.deepEqual(service.config, { transport: "cloudflare", production: true });
  assert.equal(JSON.stringify(service.config).includes("credential-must-not-serialize"), false);
});

test("CLI transport status reports Cloudflare configuration without credentials", () => {
  const result = spawnSync(process.execPath, ["bin/app.js", "mail", "transport", "status"], { cwd: path.resolve("."), encoding: "utf8",
    env: { ...process.env, MAILPORT_TRANSPORT: "cloudflare", MAILPORT_CLOUDFLARE_ACCOUNT_ID: "account-secret",
      MAILPORT_CLOUDFLARE_API_TOKEN: "token-secret", MAILPORT_URL: "" } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Transport: cloudflare/); assert.match(result.stdout, /Account: \*\*\*\*\*\*\*\*/);
  assert.match(result.stdout, /API token: configured/); assert.equal(result.stdout.includes("account-secret"), false); assert.equal(result.stdout.includes("token-secret"), false);
});
