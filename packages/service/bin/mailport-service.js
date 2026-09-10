#!/usr/bin/env node
import { createMailService } from "../dist/index.js";
const service=createMailService({host:process.env.HOST||"0.0.0.0"});
await service.start();
const shutdown=async()=>{await service.stop();process.exit(0);};
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
