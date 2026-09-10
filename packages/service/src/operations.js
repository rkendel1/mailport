import fs from "node:fs";
import path from "node:path";
import crypto, { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { MailPortError, ERROR_CODES } from "@mailerport/core";

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const normalizeEmail = (email) => String(email).trim().toLowerCase();

export class FileOperationsStore {
  constructor({ filePath, resolver = dns } = {}) {
    this.filePath = filePath;
    this.resolver = resolver;
    this.state = { domains: [], identities: [], suppressions: [], keys: [] };
    this.rate = new Map();
    this.signingKeys = new Map();
    this.#load();
  }
  #load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.filePath, "utf8")) };
    let migratedSecret = false;
    for (const domain of this.state.domains) {
      if (domain.dkim?.private_key) { this.signingKeys.set(domain.domain, domain.dkim.private_key); delete domain.dkim.private_key; migratedSecret = true; }
    }
    if (migratedSecret) this.#save();
  }
  #save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
  createDomain(domainName) {
    const domain = String(domainName).trim().toLowerCase();
    const existing = this.state.domains.find((item) => item.domain === domain);
    if (existing) return clone(existing);
    const selector = `mailport-${crypto.randomBytes(6).toString("hex")}`;
    let privateKey = this.signingKeys.get(domain);
    let publicKey;
    if (privateKey) {
      publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
    } else {
      const generated = crypto.generateKeyPairSync("rsa", { modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
      publicKey = generated.publicKey; privateKey = generated.privateKey;
    }
    const publicValue = publicKey.replace(/-----[^-]+-----|\s/g, "");
    const item = { domain, status: "pending", created_at: now(),
      spf: { status: "pending", name: domain, record: "v=spf1 include:_spf.mailport.local ~all" },
      dkim: { status: "pending", selector, name: `${selector}._domainkey.${domain}`,
        record: `v=DKIM1; k=rsa; p=${publicValue}` },
      dmarc: { status: "recommended", name: `_dmarc.${domain}`, record: "v=DMARC1; p=none; rua=mailto:dmarc@" + domain } };
    this.signingKeys.set(domain, privateKey);
    this.state.domains.push(item); this.#save(); return this.#publicDomain(item);
  }
  #publicDomain(item) { const value = clone(item); if (value?.dkim) delete value.dkim.private_key; return value; }
  listDomains() { return this.state.domains.map((item) => this.#publicDomain(item)); }
  getDomain(domain) { const item = this.state.domains.find((value) => value.domain === domain); return item ? this.#publicDomain(item) : null; }
  deleteDomain(domain) { this.state.domains = this.state.domains.filter((item) => item.domain !== domain); this.#save(); }
  async verifyDomain(domainName) {
    const item = this.state.domains.find((value) => value.domain === domainName);
    if (!item) return null;
    item.status = "verifying"; this.#save();
    const checks = async (name, record) => { try { return (await this.resolver.resolveTxt(name)).flat().join("").includes(record); } catch { return false; } };
    const [spf, dkim] = await Promise.all([checks(item.spf.name, item.spf.record), checks(item.dkim.name, item.dkim.record)]);
    item.spf.status = spf ? "verified" : "pending"; item.dkim.status = dkim ? "verified" : "pending";
    item.status = spf && dkim ? "active" : "pending"; item.verified_at = item.status === "active" ? now() : null;
    for (const identity of this.state.identities.filter((value) => value.domain === item.domain)) identity.status = item.status === "active" ? "active" : "pending";
    this.#save(); return this.#publicDomain(item);
  }
  createIdentity({ identity, address, application_id = null, tenant_id = null }) {
    const domain = normalizeEmail(address).split("@").at(-1);
    if (!this.getDomain(domain)) throw new MailPortError(ERROR_CODES.MAIL_DOMAIN_NOT_VERIFIED, "Identity domain is not configured");
    const item = { identity, address: normalizeEmail(address), domain, application_id, tenant_id,
      status: this.getDomain(domain).status === "active" ? "active" : "pending", created_at: now() };
    this.state.identities = this.state.identities.filter((value) => !(value.identity === identity && value.application_id === application_id));
    this.state.identities.push(item); this.#save(); return clone(item);
  }
  listIdentities(principal) { return this.state.identities.filter((item) => !principal || principal.admin || item.application_id === principal.application_id).map(clone); }
  signingForIdentity(identityName, principal) {
    const identity = this.state.identities.find((item) => item.identity === identityName && item.status === "active" &&
      (!item.application_id || item.application_id === principal.application_id));
    const domain = identity && this.state.domains.find((item) => item.domain === identity.domain && item.status === "active");
    const privateKey = domain && this.signingKeys.get(domain.domain);
    return domain && privateKey ? { domain: domain.domain, selector: domain.dkim.selector, privateKey } : null;
  }
  setSigningKey(domain, privateKey) { this.signingKeys.set(domain, privateKey); }
  signingReady() { return this.state.domains.filter((item) => item.status === "active").every((item) => this.signingKeys.has(item.domain)); }
  addSuppression({ email, reason = "manual", source = "admin", application_id = null, tenant_id = null }) {
    const item = { email: normalizeEmail(email), reason, source, application_id, tenant_id, created_at: now() };
    this.state.suppressions = this.state.suppressions.filter((value) => !(value.email === item.email && value.application_id === application_id));
    this.state.suppressions.push(item); this.#save(); return clone(item);
  }
  listSuppressions(principal) { return this.state.suppressions.filter((item) => !principal || principal.admin || item.application_id === principal.application_id).map(clone); }
  isSuppressed(email, principal) { return this.state.suppressions.find((item) => item.email === normalizeEmail(email) &&
    (!item.application_id || item.application_id === principal.application_id) && (!item.tenant_id || item.tenant_id === principal.tenant_id)); }
  addKey({ token, key_id = `key_${randomUUID()}`, application_id, tenant_id = null, scopes = ["mail.send", "mail.read"] }) {
    const item = { token_hash: crypto.createHash("sha256").update(token).digest("hex"), key_id, application_id, tenant_id,
      scopes, status: "active", created_at: now(), last_used_at: null };
    this.state.keys.push(item); this.#save(); return { ...clone(item), token_hash: undefined };
  }
  authenticate(token) {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const key = this.state.keys.find((item) => item.token_hash === hash && item.status === "active");
    if (!key) return null; key.last_used_at = now(); this.#save();
    return { key_id: key.key_id, application_id: key.application_id, tenant_id: key.tenant_id, scopes: key.scopes };
  }
  enforceRate(principal, identity, recipients, limits = {}) {
    const maximum = limits.messagesPerMinute || limits.messages_per_minute;
    if (!maximum) return;
    const minute = Math.floor(Date.now() / 60_000);
    for (const dimension of [`app:${principal.application_id}`, `identity:${principal.application_id}:${identity}`,
      ...recipients.map((email) => `recipient:${principal.application_id}:${normalizeEmail(email)}`)]) {
      const key = `${minute}:${dimension}`; const count = (this.rate.get(key) || 0) + 1; this.rate.set(key, count);
      if (count > maximum) throw new MailPortError(ERROR_CODES.MAIL_RATE_LIMITED, "Mail rate limit exceeded", { retry_after_ms: 60_000 - Date.now() % 60_000 });
    }
  }
}
