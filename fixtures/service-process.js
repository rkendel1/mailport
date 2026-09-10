import { createMailService } from "../src/service.js";

const service = createMailService({
  host: "127.0.0.1", port: Number(process.env.TEST_PORT), apiKey: "test-key",
  identities: { system: "notifications@example.test" },
  outbox: { filePath: process.env.TEST_OUTBOX },
  worker: { enabled: process.env.TEST_WORKER !== "off", pollIntervalMs: 10 },
  transport: { type: "local" }, testEndpointsEnabled: true,
});
await service.start();
process.send?.("ready");
const stop = async () => { await service.stop(); process.exit(0); };
process.on("SIGTERM", stop);
