import { MailPortError, ERROR_CODES } from "@mailerport/core";

export function createDeliveryEventSource({ mail, operations, suppressHardBounces = true, suppressComplaints = true } = {}) {
  return {
    async consume(input) {
      const type = input.type || input.event_type;
      if (!["delivered", "bounced", "complained"].includes(type))
        throw new MailPortError(ERROR_CODES.MAIL_DELIVERY_FAILED, `Unsupported delivery event: ${type}`);
      const message = await mail.recordDeliveryEvent({ ...input, type });
      if (!message) return null;
      const shouldSuppress = (type === "bounced" && input.bounce_type === "hard" && suppressHardBounces) ||
        (type === "complained" && suppressComplaints);
      if (shouldSuppress && input.recipient) operations.addSuppression({ email: input.recipient,
        application_id: message.application_id, tenant_id: message.tenant_id,
        reason: type === "complained" ? "complaint" : "hard_bounce", source: "delivery_event" });
      return message;
    },
  };
}
