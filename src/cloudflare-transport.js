import { MailPortError, ERROR_CODES } from "./errors.js";

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";

function providerError(code, message, retryable, status) {
  return new MailPortError(code, message, { provider: "cloudflare", retryable, ...(status ? { status } : {}) });
}

function normalizeHttpError(status, hint = "", providerCode) {
  if (providerCode === 10103) return providerError(ERROR_CODES.MAIL_PROVIDER_AUTH_FAILED, "Cloudflare rejected this API token type", false, status);
  if (providerCode === 10101 || providerCode === 10102 || status === 401)
    return providerError(ERROR_CODES.MAIL_PROVIDER_AUTH_FAILED, "Cloudflare authentication or Email Sending permission failed", false, status);
  if (providerCode === 10203 || /sending.{0,20}disabled/i.test(hint))
    return providerError(ERROR_CODES.MAIL_PROVIDER_SENDING_DISABLED, "Cloudflare email sending is disabled", false, status);
  if (providerCode === 10105 || status === 403)
    return providerError(ERROR_CODES.MAIL_PROVIDER_NOT_ENTITLED, "Cloudflare Email Service is not enabled for this account", false, status);
  if (status === 429) return providerError(ERROR_CODES.MAIL_PROVIDER_RATE_LIMITED, "Cloudflare rate limit exceeded", true, status);
  if (status >= 500) return providerError(ERROR_CODES.MAIL_PROVIDER_UNAVAILABLE, "Cloudflare Email Service is unavailable", true, status);
  return providerError(ERROR_CODES.MAIL_PROVIDER_REJECTED, "Cloudflare rejected the email submission", false, status);
}

export class CloudflareEmailHttpClient {
  #apiToken;
  constructor({ accountId, apiToken, baseUrl = DEFAULT_BASE_URL, fetcher = globalThis.fetch } = {}) {
    this.accountId = accountId; this.#apiToken = apiToken; this.baseUrl = baseUrl.replace(/\/$/, ""); this.fetcher = fetcher;
  }
  async send(request) {
    let response;
    try { response = await this.fetcher(`${this.baseUrl}/accounts/${encodeURIComponent(this.accountId)}/email/sending/send`, {
      method: "POST", headers: { authorization: `Bearer ${this.#apiToken}`, "content-type": "application/json" }, body: JSON.stringify(request) }); }
    catch { throw providerError(ERROR_CODES.MAIL_PROVIDER_UNAVAILABLE, "Cloudflare Email Service could not be reached", true); }
    if (!response.ok) { let hint = "", providerCode; try { const failure = await response.json();
      hint = (failure.errors || []).map((item) => item.message).join(" "); providerCode = failure.errors?.[0]?.code; } catch {}
      throw normalizeHttpError(response.status, hint, providerCode); }
    let body;
    try { body = await response.json(); } catch { throw providerError(ERROR_CODES.MAIL_PROVIDER_UNAVAILABLE, "Cloudflare returned an invalid response", true); }
    if (!body?.success) throw normalizeHttpError(response.status || 400);
    return { success: true, messageId: body.result?.message_id || null,
      queued: [...(body.result?.queued || [])], delivered: [...(body.result?.delivered || [])] };
  }
}

export class FakeCloudflareEmailClient {
  constructor({ response = { success: true, messageId: "cf_test_message" }, error } = {}) {
    this.response = response; this.error = error; this.requests = [];
  }
  async send(request) { this.requests.push(structuredClone(request)); if (this.error) throw this.error; return structuredClone(this.response); }
}

function attachmentContent(content) {
  if (Buffer.isBuffer(content)) return content.toString("base64");
  return Buffer.from(String(content ?? ""), "utf8").toString("base64");
}

export class CloudflareTransport {
  constructor({ accountId, apiToken, baseUrl, client, fetcher } = {}) {
    this.kind = "cloudflare"; this.accountId = accountId; this.configured = Boolean(accountId && (apiToken || client));
    this.client = client || new CloudflareEmailHttpClient({ accountId, apiToken, baseUrl, fetcher });
  }
  async send(message) {
    const request = { to: message.to.length === 1 ? message.to[0] : message.to, from: message.from, subject: message.subject };
    if (message.html) request.html = message.html;
    if (message.text) request.text = message.text;
    if (message.cc?.length) request.cc = message.cc.length === 1 ? message.cc[0] : message.cc;
    if (message.bcc?.length) request.bcc = message.bcc.length === 1 ? message.bcc[0] : message.bcc;
    if (message.reply_to?.length) request.reply_to = message.reply_to.length === 1 ? message.reply_to[0] : message.reply_to;
    if (message.headers && Object.keys(message.headers).length) request.headers = message.headers;
    if (message.attachments?.length) request.attachments = message.attachments.map((item) => ({
      content: attachmentContent(item.content), filename: item.filename || item.name || "attachment",
      type: item.type || item.contentType || "application/octet-stream", disposition: item.disposition || "attachment",
      ...(item.contentId || item.content_id ? { content_id: item.contentId || item.content_id } : {}) }));
    try {
      const response = await this.client.send(request);
      return { status: "accepted", transport: "cloudflare", provider: "cloudflare",
        providerMessageId: response.messageId || response.message_id || null, message_id: response.messageId || response.message_id || null };
    } catch (error) {
      const retryable = error?.details?.retryable === true;
      return { status: retryable ? "retry" : "failed", provider: "cloudflare",
        error: { code: error?.code || ERROR_CODES.MAIL_PROVIDER_REJECTED, message: error?.message || "Cloudflare email submission failed" } };
    }
  }
}

export function createCloudflareTransport(options) { return new CloudflareTransport(options); }
