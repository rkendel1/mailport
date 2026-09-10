import fs from "node:fs";

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
    this.messages = new Map();
    this.#load();
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
    this.messages.set(message.message_id, deepClone(message));
    this.#persist();
  }

  clear() {
    this.messages.clear();
    this.#persist();
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
      const candidate = storage.list().find((message) => {
        if (message.status !== "queued") return false;
        const nextRetry = message.next_retry_at ? Date.parse(message.next_retry_at) : 0;
        if (nextRetry > now) return false;
        const leasedUntil = message.lease_expires_at ? Date.parse(message.lease_expires_at) : 0;
        return !leasedUntil || leasedUntil <= now;
      });
      if (!candidate) return null;

      const claimed = {
        ...candidate,
        lease_token: `lease-${Math.random().toString(16).slice(2)}`,
        lease_expires_at: new Date(now + leaseMs).toISOString(),
        updated_at: nowIso(),
      };
      storage.put(claimed);
      return claimed;
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
