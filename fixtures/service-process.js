import { createMailService } from "../src/service.js";
import fs from "node:fs";

const transport = process.env.TEST_DELIVERY_MARKER ? { kind: "custom", async send() {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.TEST_DELIVERY_DELAY || 100)));
  fs.appendFileSync(process.env.TEST_DELIVERY_MARKER, "delivered\n");
  return { status: "sent", transport: "test" };
} } : { type: "local" };

const service = createMailService({
  host: "127.0.0.1", port: Number(process.env.TEST_PORT), apiKey: "test-key",
  identities: { system: "notifications@example.test" },
  outbox: { filePath: process.env.TEST_OUTBOX },
  worker: { enabled: process.env.TEST_WORKER !== "off", pollIntervalMs: 10 },
  transport, testEndpointsEnabled: true,
});
await service.start();
process.send?.("ready");
const stop = async () => { await service.stop(); process.exit(0); };
process.on("SIGTERM", stop);
