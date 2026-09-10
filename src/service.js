import { createMailPort } from "./mailport.js";
import { createMailPortService } from "./remote-service.js";
import { FileOperationsStore } from "./operations.js";
import { validateProductionConfig } from "./production-config.js";
import { createDeliveryEventSource } from "./delivery-events.js";
import { FileSigningKeyStore } from "./signing-key-store.js";
import { validateMtaEgress, validateMtaIdentity } from "./mta-readiness.js";
import { createDirectMxTransport, createSmtpTransport } from "./transports.js";

export function createMailService(options = {}) {
  const environment = options.environment || process.env;
  const production = validateProductionConfig(options, environment);
  const worker = options.worker || {};
  let operations;
  const transport = options.transport || { type: environment.MAILPORT_TRANSPORT || "local" };
  let transportConfig = typeof transport === "string" ? transport : { ...transport, kind: transport.kind || transport.type };
  const transportType = typeof transportConfig === "string" ? transportConfig : transportConfig.type || transportConfig.kind;
  if (transportType === "direct-mx") transportConfig = createDirectMxTransport({
    ...(typeof transportConfig === "object" ? transportConfig : {}), hostname: transportConfig.hostname || environment.MAILPORT_MTA_HOSTNAME,
    envelopeFrom: transportConfig.envelopeFrom || environment.MAILPORT_ENVELOPE_FROM,
    requireTLS: transportConfig.requireTLS ?? environment.MAILPORT_MTA_REQUIRE_TLS === "true",
    resolver: options.mta?.resolver,
    signingResolver: (message) => operations?.signingForMessage(message),
  });
  if (transportType === "smtp") transportConfig = createSmtpTransport({
    ...(typeof transportConfig === "object" ? transportConfig : {}), host: transportConfig.host || environment.MAILPORT_SMTP_HOST,
    port: Number(transportConfig.port || environment.MAILPORT_SMTP_PORT || 25), username: transportConfig.username || environment.MAILPORT_SMTP_USERNAME,
    password: transportConfig.password || environment.MAILPORT_SMTP_PASSWORD, secure: transportConfig.secure ?? environment.MAILPORT_SMTP_SECURE === "true",
    requireTLS: transportConfig.requireTLS ?? (environment.MAILPORT_SMTP_REQUIRE_TLS === "true" || environment.NODE_ENV === "production"),
    signingResolver: (message) => operations?.signingForMessage(message) });
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
  const signingKeyStore = options.signingKeyStore || (environment.MAILPORT_KEY_ENCRYPTION_KEY ? new FileSigningKeyStore({
    filePath: options.signingKeys?.filePath || environment.MAILPORT_SIGNING_KEYS || "/data/signing-keys.json",
    encryptionKey: environment.MAILPORT_KEY_ENCRYPTION_KEY }) : null);
  operations = options.operationsStore || new FileOperationsStore({ filePath: options.operations?.filePath || environment.MAILPORT_OPERATIONS,
    signingKeyStore,
    resolver: options.operations?.resolver, dnsConfig: options.operations?.dnsConfig || {
      spfValue: environment.MAILPORT_SPF_VALUE || (environment.MAILPORT_EGRESS_IP ? `v=spf1 ${environment.MAILPORT_EGRESS_IP.includes(":") ? "ip6" : "ip4"}:${environment.MAILPORT_EGRESS_IP} -all` : undefined), dmarcValue: environment.MAILPORT_DMARC_VALUE,
      dkimSelector: environment.MAILPORT_DKIM_SELECTOR,
      dkimCnameTargets: environment.MAILPORT_DKIM_CNAME_TARGETS?.split(",").map((value) => value.trim()).filter(Boolean),
    } });
  for (const key of options.apiKeys || []) operations.addKey(key);
  if (environment.MAILPORT_DKIM_DOMAIN && environment.MAILPORT_DKIM_PRIVATE_KEY)
    operations.setSigningKey(environment.MAILPORT_DKIM_DOMAIN, environment.MAILPORT_DKIM_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const deliveryEvents = createDeliveryEventSource({ mail, operations, ...(options.deliveryEvents || {}) });
  const server = createMailPortService(mail, { host: options.host, port: options.port || Number(environment.PORT) || 8789,
    apiKey: options.apiKey || environment.MAILPORT_API_KEY,
    adminKey: options.adminKey || environment.MAILPORT_ADMIN_KEY, operations, rateLimits: options.limits,
    applicationId: options.applicationId || environment.MAILPORT_APPLICATION_ID || "app", production, deliveryEvents,
    maxBodyBytes: options.maxBodyBytes, testEndpointsEnabled: options.testEndpointsEnabled ?? transportConfig.kind !== "smtp" });
  const startServer = server.start;
  return { ...server, async start() {
    if (production.production && transportType === "direct-mx") {
      const egressIp = transport.egressIp || environment.MAILPORT_EGRESS_IP;
      await validateMtaIdentity({ hostname: transport.hostname || environment.MAILPORT_MTA_HOSTNAME,
        egressIp, resolver: options.mta?.resolver });
      await validateMtaEgress({ expectedIp: egressIp, probeUrl: options.mta?.egressProbeUrl || environment.MAILPORT_EGRESS_IP_CHECK_URL,
        fetcher: options.mta?.fetcher });
    }
    return startServer();
  }, mail, operations, deliveryEvents, production, config: options };
}
