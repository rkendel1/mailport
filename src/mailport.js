import { randomUUID } from "node:crypto";
import { MailPortError, ERROR_CODES } from "./errors.js";
import { renderTemplate, extractLinks } from "./template-renderer.js";
import { MemoryTransport, LocalTransport, SmtpTransport } from "./transports.js";

const DEFAULT_LIMITS = {
  maxAttachmentCount: 10,
  maxAttachmentSizeBytes: 10 * 1024 * 1024,
  maxMessageSizeBytes: 25 * 1024 * 1024,
};

function normalizeRecipients(input) {
  if (!input) return [];
  const values = Array.isArray(input) ? input : [input];
  return values.filter(Boolean);
}

function assertRecipients(payload) {
  const all = [
    ...normalizeRecipients(payload.to),
    ...normalizeRecipients(payload.cc),
    ...normalizeRecipients(payload.bcc),
    ...normalizeRecipients(payload.reply_to),
  ];
  if (all.length === 0) {
    throw new MailPortError(
      ERROR_CODES.MAIL_INVALID_RECIPIENT,
      "At least one recipient is required"
    );
  }
}

function estimateSizeBytes(message) {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function resolveTransportName(explicitTransport, environment = process.env) {
  return (
    explicitTransport ||
    environment.FELTDB_MAIL_TRANSPORT ||
    environment.MAILPORT_TRANSPORT ||
    "memory"
  );
}

function createTransport(name) {
  if (name === "memory") return new MemoryTransport();
  if (name === "local") return new LocalTransport();
  if (name === "smtp") return new SmtpTransport();
  throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, `Unknown transport: ${name}`);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMailPort(config) {
  const transportName = resolveTransportName(config.transport, config.environment);
  const transport = createTransport(transportName);
  const identities = config.identities || {};
  const templates = config.templates || {};
  const limits = { ...DEFAULT_LIMITS, ...(config.limits || {}) };
  const messages = new Map();
  const idempotency = new Map();

  const mail = {
    transportName,
    async send(templateOrPayload, maybePayload) {
      const isTemplateSend = typeof templateOrPayload === "string";
      const payload = isTemplateSend ? { ...(maybePayload || {}) } : { ...templateOrPayload };

      if (!payload.identity || !identities[payload.identity]) {
        throw new MailPortError(
          ERROR_CODES.MAIL_IDENTITY_NOT_FOUND,
          `Unknown identity: ${payload.identity || "(missing)"}`
        );
      }

      if (isTemplateSend) {
        const templateName = templateOrPayload;
        const template = templates[templateName];
        if (!template) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEMPLATE_NOT_FOUND,
            `Unknown template: ${templateName}`
          );
        }
        payload.template = templateName;
        payload.subject = renderTemplate(template.subject || "", payload.variables);
        payload.html = renderTemplate(template.html || "", payload.variables);
        payload.text = renderTemplate(template.text || "", payload.variables);
      }

      assertRecipients(payload);

      const attachments = payload.attachments || [];
      if (attachments.length > limits.maxAttachmentCount) {
        throw new MailPortError(
          ERROR_CODES.MAIL_MESSAGE_TOO_LARGE,
          "Attachment count exceeds limit"
        );
      }
      for (const attachment of attachments) {
        const contentLength = Buffer.byteLength(String(attachment.content || ""), "utf8");
        if (contentLength > limits.maxAttachmentSizeBytes) {
          throw new MailPortError(
            ERROR_CODES.MAIL_MESSAGE_TOO_LARGE,
            "Attachment size exceeds limit"
          );
        }
      }

      if (payload.idempotencyKey && idempotency.has(payload.idempotencyKey)) {
        return deepClone(idempotency.get(payload.idempotencyKey));
      }

      const now = new Date().toISOString();
      const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
      const message = {
        message_id: messageId,
        application_id: config.applicationId || "app",
        tenant_id: payload.tenantId || null,
        identity: payload.identity,
        from: identities[payload.identity],
        to: normalizeRecipients(payload.to),
        cc: normalizeRecipients(payload.cc),
        bcc: normalizeRecipients(payload.bcc),
        reply_to: normalizeRecipients(payload.reply_to),
        subject: payload.subject || "",
        html: payload.html || "",
        text: payload.text || "",
        template: payload.template || null,
        variables: payload.variables || {},
        metadata: payload.metadata || {},
        idempotencyKey: payload.idempotencyKey || null,
        attachments,
        status: "accepted",
        created_at: now,
        updated_at: now,
      };

      if (estimateSizeBytes(message) > limits.maxMessageSizeBytes) {
        throw new MailPortError(
          ERROR_CODES.MAIL_MESSAGE_TOO_LARGE,
          "Message size exceeds limit"
        );
      }

      messages.set(messageId, message);
      message.status = "queued";
      message.updated_at = new Date().toISOString();

      try {
        const delivery = await transport.send(message);
        message.status = delivery.status || "sent";
      } catch (error) {
        message.status = "failed";
        message.last_error = error.message;
        message.updated_at = new Date().toISOString();
        if (error instanceof MailPortError) {
          throw error;
        }
        throw new MailPortError(ERROR_CODES.MAIL_DELIVERY_FAILED, error.message, {
          message_id: message.message_id,
        });
      }
      message.updated_at = new Date().toISOString();
      message.links = extractLinks({ html: message.html, text: message.text });

      if (payload.idempotencyKey) {
        idempotency.set(payload.idempotencyKey, message);
      }

      return deepClone(message);
    },
    get(messageId) {
      const message = messages.get(messageId);
      return message ? deepClone(message) : null;
    },
    list(filters = {}) {
      let items = [...messages.values()];
      if (filters.to) items = items.filter((m) => m.to.includes(filters.to));
      if (filters.subject)
        items = items.filter((m) => m.subject.toLowerCase().includes(filters.subject.toLowerCase()));
      if (filters.template) items = items.filter((m) => m.template === filters.template);
      if (filters.testRunId)
        items = items.filter((m) => m.metadata?.testRunId === filters.testRunId);
      if (filters.status) items = items.filter((m) => m.status === filters.status);
      return items.map(deepClone);
    },
    test: {
      list(filters = {}) {
        if (!config.testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        return mail.list(filters);
      },
      get(messageId) {
        if (!config.testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        return mail.get(messageId);
      },
      clear() {
        if (!config.testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        messages.clear();
        idempotency.clear();
      },
      async waitFor({ timeoutMs = 5000, intervalMs = 25, ...filters } = {}) {
        if (!config.testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const found = mail.list(filters)[0];
          if (found) return found;
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        return null;
      },
    },
  };

  return mail;
}
