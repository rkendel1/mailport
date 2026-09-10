import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MailPortError, ERROR_CODES } from "./errors.js";

function keyFrom(value) {
  if (!value) return null;
  const text = String(value).trim();
  const decoded = /^[a-f0-9]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  return decoded.length === 32 ? decoded : null;
}

export class FileSigningKeyStore {
  constructor({ filePath, encryptionKey } = {}) {
    this.filePath = filePath;
    this.key = keyFrom(encryptionKey);
    if (filePath && !this.key) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED,
      "MAILPORT_KEY_ENCRYPTION_KEY must be a base64 or hex encoded 32-byte key");
    this.values = new Map(); this.#load();
  }
  #load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const stored = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    for (const [domain, value] of Object.entries(stored)) this.values.set(domain, this.#decrypt(value));
  }
  #decrypt(value) {
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
  }
  #encrypt(value) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  }
  #save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
    const document = Object.fromEntries([...this.values].map(([domain, value]) => [domain, this.#encrypt(value)]));
    const temp = `${this.filePath}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(document), { mode: 0o600 });
    fs.renameSync(temp, this.filePath); fs.chmodSync(this.filePath, 0o600);
  }
  get(domain) { return this.values.get(domain) || null; }
  set(domain, privateKey) { this.values.set(domain, privateKey); this.#save(); }
  delete(domain) { this.values.delete(domain); this.#save(); }
  has(domain) { return this.values.has(domain); }
}
