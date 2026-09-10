import fs from "node:fs";
import path from "node:path";
import crypto, { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { MailPortError, ERROR_CODES } from "@mailerport/core";

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const normalizeEmail = (email) => String(email).trim().toLowerCase();
const spfMechanisms = (record) => String(record).trim().split(/\s+/).filter((value) =>
  value !== "v=spf1" && !/^[?+~-]?all$/i.test(value) && !value.includes("="));

export class FileOperationsStore {
  constructor({ filePath, resolver = dns, dnsConfig = {}, signingKeyStore } = {}) {
    this.filePath = filePath;
    this.resolver = resolver;
    this.dnsConfig = dnsConfig;
    this.state = { domains: [], identities: [], suppressions: [], keys: [] };
    this.rate = new Map();
    this.signingKeys = new Map();
    this.signingKeyStore = signingKeyStore;
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
    const selector = this.dnsConfig.dkimSelector || `mp-${crypto.randomBytes(6).toString("hex")}`;
    const verificationToken = crypto.randomBytes(24).toString("hex");
    let privateKey = this.signingKeyStore?.get(domain) || this.signingKeys.get(domain);
    let publicKey;
    if (privateKey) {
      publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
    } else {
      const generated = crypto.generateKeyPairSync("rsa", { modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
      publicKey = generated.publicKey; privateKey = generated.privateKey;
    }
    const publicValue = publicKey.replace(/-----[^-]+-----|\s/g, "");
    const timestamp = now();
    const item = { id: `dom_${randomUUID().replaceAll("-", "")}`, domain, status: "pending", created_at: timestamp, updated_at: timestamp,
      verification: { method: "dns", token: verificationToken, status: "pending", name: domain,
        record: `mailerport-verification=${verificationToken}` },
      spf: { status: "pending", name: domain, record: this.dnsConfig.spfValue || "v=spf1 -all",
        required_mechanisms: spfMechanisms(this.dnsConfig.spfValue || "v=spf1 -all"), merge_existing: true },
      dkim: { status: "pending", selector, name: `${selector}._domainkey.${domain}`,
        record: `v=DKIM1; k=rsa; p=${publicValue}` },
      dmarc: { status: "pending", name: `_dmarc.${domain}`, record: this.dnsConfig.dmarcValue || "v=DMARC1; p=none; rua=mailto:dmarc@" + domain } };
    const cnameTargets = this.dnsConfig.dkimCnameTargets || [];
    item.dns = [
      { type: "TXT", name: "@", fqdn: domain, purpose: "verification", value: item.verification.record },
      ...(cnameTargets.length ? cnameTargets.map((target, index) => ({ type: "CNAME", name: `mp${index + 1}._domainkey`,
        fqdn: `mp${index + 1}._domainkey.${domain}`, purpose: "dkim", value: target })) :
        [{ type: "TXT", name: `${selector}._domainkey`, fqdn: item.dkim.name, purpose: "dkim", value: item.dkim.record }]),
      { type: "TXT", name: "@", fqdn: domain, purpose: "spf", value: item.spf.record, action: "merge",
        required_mechanisms: item.spf.required_mechanisms },
      { type: "TXT", name: "_dmarc", fqdn: item.dmarc.name, purpose: "dmarc", value: item.dmarc.record },
    ];
    this.signingKeys.set(domain, privateKey);
    this.signingKeyStore?.set(domain, privateKey);
    this.state.domains.push(item); this.#save(); return this.#publicDomain(item);
  }
  #publicDomain(item) { const value = clone(item); if (value?.dkim) delete value.dkim.private_key;
    value.createdAt = value.created_at; value.updatedAt = value.updated_at;
    value.authentication = { spf: value.spf.status, dkim: value.dkim.status, dmarc: value.dmarc.status };
    if (value.verification.verified_at) value.verification.verifiedAt = value.verification.verified_at;
    return value; }
  listDomains() { return this.state.domains.map((item) => this.#publicDomain(item)); }
  getDomain(domain) { const item = this.state.domains.find((value) => value.domain === domain); return item ? this.#publicDomain(item) : null; }
  getDomainDns(domain) { return this.getDomain(domain)?.dns || null; }
  deleteDomain(domain) { this.state.domains = this.state.domains.filter((item) => item.domain !== domain); this.signingKeyStore?.delete(domain); this.signingKeys.delete(domain); this.#save(); }
  async verifyDomain(domainName) {
    const item = this.state.domains.find((value) => value.domain === domainName);
    if (!item) return null;
    const matches = async (record) => { try { const answers = record.type === "CNAME"
      ? await this.resolver.resolveCname(record.fqdn) : (await this.resolver.resolveTxt(record.fqdn)).map((parts) => parts.join(""));
      if (record.purpose === "spf") { const policies = answers.filter((answer) => /^v=spf1(?:\s|$)/i.test(answer));
        return policies.length === 1 && (record.required_mechanisms || spfMechanisms(record.value))
          .every((mechanism) => policies[0].split(/\s+/).includes(mechanism)); }
      return answers.some((answer) => String(answer).replace(/\.$/, "") === String(record.value).replace(/\.$/, "")); } catch { return false; } };
    const results = await Promise.all(item.dns.map(matches));
    const has = (purpose) => item.dns.map((record, index) => record.purpose !== purpose || results[index]).every(Boolean);
    const ownership = has("verification"), spf = has("spf"), dkim = has("dkim"), dmarc = has("dmarc");
    item.verification.status = ownership ? "verified" : "pending"; item.verification.verified_at = ownership ? now() : null;
    item.spf.status = spf ? "verified" : "pending"; item.dkim.status = dkim ? "verified" : "pending"; item.dmarc.status = dmarc ? "verified" : "pending";
    item.status = ownership && spf && dkim && dmarc ? "active" : ownership ? "verified" : "pending";
    item.verified_at = item.status === "active" ? now() : null; item.updated_at = now();
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
    const privateKey = domain && (this.signingKeyStore?.get(domain.domain) || this.signingKeys.get(domain.domain));
    return domain && privateKey ? { domain: domain.domain, selector: domain.dkim.selector, privateKey } : null;
  }
  signingForMessage(message) { return this.signingForIdentity(message.identity,
    { application_id: message.application_id, tenant_id: message.tenant_id }); }
  setSigningKey(domain, privateKey) { this.signingKeys.set(domain, privateKey); this.signingKeyStore?.set(domain, privateKey); }
  signingReady() { return this.state.domains.filter((item) => item.status === "active").every((item) =>
    this.signingKeyStore?.has(item.domain) || this.signingKeys.has(item.domain)); }
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
