import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fork } from "node:child_process";

const fixture = new URL("../fixtures/service-process.js", import.meta.url);
const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
function start(env) {
  return new Promise((resolve, reject) => {
    const child = fork(fixture, [], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    child.once("message", () => resolve(child)); child.once("error", reject);
  });
}
const stop = (child) => new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGKILL"); });

test("accepted mail survives a real service process restart", async () => {
  const port = await freePort();
  const outbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-process-")), "outbox.json");
  const env = { TEST_PORT: String(port), TEST_OUTBOX: outbox, TEST_WORKER: "off" };
  let child = await start(env);
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST",
    headers: { authorization: "Bearer test-key", "content-type": "application/json" },
    body: JSON.stringify({ identity: "system", to: "user@example.test", subject: "Restart", text: "Durable" }) });
  const accepted = await response.json();
  assert.equal(accepted.status, "queued");
  await stop(child);
  child = await start({ ...env, TEST_WORKER: "on" });
  let message;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    message = await fetch(`http://127.0.0.1:${port}/v1/messages/${accepted.message_id}`,
      { headers: { authorization: "Bearer test-key" } }).then((item) => item.json());
    if (message.status === "sent") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await stop(child);
  assert.equal(message.message_id, accepted.message_id);
  assert.equal(message.status, "sent");
});
