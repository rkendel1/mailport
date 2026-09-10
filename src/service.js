import { createMailPort } from "./mailport.js";
import { createMailPortService } from "./remote-service.js";

export function createMailService(options = {}) {
  const environment = options.environment || process.env;
  const worker = options.worker || {};
  const transport = options.transport || { type: environment.MAILPORT_TRANSPORT || "local" };
  const transportConfig = typeof transport === "string" ? transport : { ...transport, kind: transport.kind || transport.type };
  const mail = createMailPort({
    applicationId: options.applicationId || environment.MAILPORT_APPLICATION_ID || "app",
    identities: options.identities || { system: "notifications@example.test" },
    templates: options.templates || {}, environment,
    transport: transportConfig,
    testEndpointsEnabled: options.testEndpointsEnabled ?? transportConfig.kind !== "smtp",
    outbox: { enabled: true, filePath: options.outbox?.filePath || environment.MAILPORT_OUTBOX || ".mailport/outbox.json",
      workerEnabled: worker.enabled !== false, pollIntervalMs: worker.pollIntervalMs,
      leaseMs: worker.leaseMs, maxAttempts: worker.maxAttempts, retryBaseMs: worker.retryBaseMs },
  });
  const server = createMailPortService(mail, { host: options.host, port: options.port,
    apiKey: options.apiKey || environment.MAILPORT_API_KEY,
    maxBodyBytes: options.maxBodyBytes, testEndpointsEnabled: options.testEndpointsEnabled ?? transportConfig.kind !== "smtp" });
  return { ...server, mail, config: options };
}
