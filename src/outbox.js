import fs from "node:fs";
import { randomUUID } from "node:crypto";

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepMs(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

class FileBackedMessages {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = filePath ? `${filePath}.lock` : null;
    this.messages = new Map();
    this.#load();
  }

  #withLock(callback, { retryCount = 20, retryDelayMs = 5 } = {}) {
    if (!this.lockPath) {
      return callback();
    }
    let lockFd = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        lockFd = fs.openSync(this.lockPath, "wx");
        break;
      } catch (error) {
        if (!error || error.code !== "EEXIST") {
          throw error;
        }
        if (attempt === retryCount) {
          throw new Error("Outbox lock contention: unable to acquire file lock");
        }
        sleepMs(retryDelayMs);
      }
    }

    try {
      this.messages.clear();
      this.#load();
      return callback();
    } finally {
      if (lockFd !== null) {
        fs.closeSync(lockFd);
      }
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    }
  }

  #load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) return;
    const items = JSON.parse(raw);
    for (const item of items) {
      this.messages.set(item.message_id, item);
    }
  }

  #persist() {
    if (!this.filePath) return;
    fs.writeFileSync(
      this.filePath,
      JSON.stringify([...this.messages.values()], null, 2),
      "utf8"
    );
  }

  get(messageId) {
    const message = this.messages.get(messageId);
    return message ? deepClone(message) : null;
  }

  list() {
    return [...this.messages.values()].map(deepClone);
  }

  put(message) {
    this.#withLock(() => {
      this.messages.set(message.message_id, deepClone(message));
      this.#persist();
    });
  }

  findOne(predicate) {
    for (const message of this.messages.values()) {
      if (predicate(message)) return deepClone(message);
    }
    return null;
  }

  clear() {
    this.#withLock(() => {
      this.messages.clear();
      this.#persist();
    });
  }

  claimOne(predicate, updater) {
    return this.#withLock(() => {
      for (const message of this.messages.values()) {
        if (!predicate(message)) continue;
        const updated = updater(deepClone(message));
        this.messages.set(updated.message_id, deepClone(updated));
        this.#persist();
        return updated;
      }
      return null;
    });
  }
}

export function createOutbox({ filePath } = {}) {
  const storage = new FileBackedMessages(filePath);

  return {
    get(messageId) {
      return storage.get(messageId);
    },
    list() {
      return storage.list();
    },
    clear() {
      storage.clear();
    },
    findByIdempotencyKey(idempotencyKey) {
      if (!idempotencyKey) return null;
      return (
        storage
          .list()
          .find((message) => message.idempotencyKey && message.idempotencyKey === idempotencyKey) ||
        null
      );
    },
    put(message) {
      storage.put(message);
    },
    claimNext({ leaseMs = 30_000 } = {}) {
      const now = Date.now();
      const candidate = storage.claimOne(
        (message) => {
        if (message.status !== "queued") return false;
        const nextRetry = message.next_retry_at ? Date.parse(message.next_retry_at) : 0;
        if (nextRetry > now) return false;
        const leasedUntil = message.lease_expires_at ? Date.parse(message.lease_expires_at) : 0;
        return !leasedUntil || leasedUntil <= now;
        },
        (message) => ({
          ...message,
          lease_token: `lease-${randomUUID().replace(/-/g, "")}`,
          lease_expires_at: new Date(now + leaseMs).toISOString(),
          updated_at: nowIso(),
        })
      );
      return candidate || null;
    },
    markSent(messageId, status = "sent") {
      const message = storage.get(messageId);
      if (!message) return null;
      const next = {
        ...message,
        status,
        lease_token: null,
        lease_expires_at: null,
        next_retry_at: null,
        updated_at: nowIso(),
      };
      storage.put(next);
      return next;
    },
    markDeliveryFailure(messageId, error, { maxAttempts = 3, retryBaseMs = 250 } = {}) {
      const message = storage.get(messageId);
      if (!message) return null;
      const attempts = (message.delivery_attempts || 0) + 1;
      const exhausted = attempts >= maxAttempts;
      const next = {
        ...message,
        delivery_attempts: attempts,
        status: exhausted ? "failed" : "queued",
        lease_token: null,
        lease_expires_at: null,
        next_retry_at: exhausted
          ? null
          : new Date(Date.now() + retryBaseMs * 2 ** (attempts - 1)).toISOString(),
        updated_at: nowIso(),
        last_error: error?.message || String(error),
      };
      storage.put(next);
      return next;
    },
  };
}

export function createOutboxWorker({
  outbox,
  transport,
  maxAttempts = 3,
  retryBaseMs = 250,
  leaseMs = 30_000,
} = {}) {
  let running = false;

  return {
    async tick() {
      if (running) return;
      running = true;
      try {
        while (true) {
          const message = outbox.claimNext({ leaseMs });
          if (!message) return;
          try {
            const delivery = await transport.send(message);
            outbox.markSent(message.message_id, delivery?.status || "sent");
          } catch (error) {
            outbox.markDeliveryFailure(message.message_id, error, {
              maxAttempts,
              retryBaseMs,
            });
          }
        }
      } finally {
        running = false;
      }
    },
  };
}
