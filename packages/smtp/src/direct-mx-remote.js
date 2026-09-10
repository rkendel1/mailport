const encodeAttachment = (item) => ({ filename: item.filename || item.name || "attachment",
  type: item.type || item.contentType || "application/octet-stream", disposition: item.disposition || "attachment",
  contentBase64: (Buffer.isBuffer(item.content) ? item.content : Buffer.from(String(item.content ?? ""))).toString("base64"),
  ...(item.contentId || item.content_id ? { contentId: item.contentId || item.content_id } : {}) });
export class RemoteDirectMxTransport {
  #deliveryToken;
  constructor({ workerUrl, deliveryToken, fetcher = globalThis.fetch, signingResolver, timeoutMs = 45_000 } = {}) { this.kind = "direct-mx";
    this.workerUrl = String(workerUrl || "").replace(/\/$/, ""); this.#deliveryToken = deliveryToken; this.fetcher = fetcher;
    this.signingResolver = signingResolver; this.timeoutMs = timeoutMs; }
  async send(message) { const signing = await this.signingResolver?.(message);
    const job = { version: 1, messageId: message.message_id, attempt: message.attempt || 1,
      envelope: { from: message.from, to: [...message.to, ...(message.cc || []), ...(message.bcc || [])] },
      message: { from: message.from, to: message.to, cc: message.cc || [], bcc: message.bcc || [], replyTo: message.reply_to || [],
        subject: message.subject, text: message.text || "", html: message.html || "", headers: message.headers || {},
        attachments: (message.attachments || []).map(encodeAttachment) }, correlation: { tenantId: message.tenant_id || null,
        idempotencyKey: message.idempotencyKey || null }, signing: signing ? { domain: signing.domain, selector: signing.selector } : null };
    let response; try { response = await this.fetcher(`${this.workerUrl}/v1/deliver`, { method: "POST", signal: AbortSignal.timeout(this.timeoutMs),
      headers: { authorization: `Bearer ${this.#deliveryToken}`, "content-type": "application/json" }, body: JSON.stringify(job) }); }
    catch { return { status: "retry", transport: "direct-mx", error: { code: "MAIL_DIRECT_MX_WORKER_UNAVAILABLE", message: "Direct-MX worker unavailable" } }; }
    let result; try { result = await response.json(); } catch { result = null; }
    if (!response.ok) { const retryable = response.status === 429 || response.status >= 500; return { status: retryable ? "retry" : "failed",
      transport: "direct-mx", error: { code: result?.error || "MAIL_DIRECT_MX_WORKER_REJECTED", message: result?.message || "Direct-MX worker rejected delivery" } }; }
    if (result?.messageId !== message.message_id) return { status: "retry", transport: "direct-mx",
      error: { code: "MAIL_DIRECT_MX_CORRELATION_FAILED", message: "Direct-MX worker returned invalid correlation" } };
    const common = { transport: "direct-mx", provider: "direct-mx", message_id: message.message_id,
      metadata: { smtp: result.smtp || null, recipient: result.recipient || null, evidence: result.evidence || [] } };
    if (result.outcome === "accepted") return { ...common, status: "accepted" };
    return { ...common, status: result.retryable || result.outcome === "temporary_failure" ? "retry" : "failed",
      error: { code: result.error?.code || "MAIL_DIRECT_MX_DELIVERY_FAILED", message: result.error?.message || "Direct-MX delivery failed" } };
  }
  toJSON() { return { kind: this.kind, workerUrl: this.workerUrl, configured: Boolean(this.workerUrl && this.#deliveryToken) }; }
}
export const createRemoteDirectMxTransport = (options) => new RemoteDirectMxTransport(options);
