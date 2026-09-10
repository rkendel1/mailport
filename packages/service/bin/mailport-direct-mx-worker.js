#!/usr/bin/env node
import { createDirectMxWorker } from "../dist/index.js";
const worker = createDirectMxWorker();
await worker.start();
let stopping = false;
const shutdown = async () => { if (stopping) return; stopping = true; await worker.stop(); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
