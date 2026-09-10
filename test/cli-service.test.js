import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

test("service command boots with smtp transport configured in environment", async () => {
  const port = await freePort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-cli-service-"));
  const child = spawn(process.execPath, ["bin/app.js", "mail", "service", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: path.resolve(new URL("..", import.meta.url).pathname),
    env: {
      ...process.env,
      NODE_ENV: "production",
      MAILPORT_TRANSPORT: "smtp",
      MAILPORT_API_KEY: "production-key",
      MAILPORT_OUTBOX: path.join(directory, "outbox.json"),
      MAILPORT_OPERATIONS: path.join(directory, "operations.json"),
      MAILPORT_SMTP_HOST: "smtp.example.test",
      MAILPORT_SMTP_PORT: "587",
      MAILPORT_SMTP_USERNAME: "username",
      MAILPORT_SMTP_PASSWORD: "password",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const errors = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => errors.push(chunk));

  let exitCode = null;
  child.once("exit", (code) => { exitCode = code; });

  try {
    let health;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (exitCode !== null) break;
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.json());
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.equal(exitCode, null, errors.join(""));
    assert.deepEqual(health, { ok: true });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
});
