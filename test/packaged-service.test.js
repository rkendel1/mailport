import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
  const { port } = server.address(); server.close(() => resolve(port)); }); });

test("production service artifact runs without repository source or SDK", async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-runtime-"));
  for (const name of ["core", "mime", "smtp", "service"]) {
    const target = path.join(runtime, "node_modules", "@mailerport", name); fs.mkdirSync(target, { recursive: true });
    fs.cpSync(path.join(root, "packages", name, "dist"), path.join(target, "dist"), { recursive: true });
    fs.copyFileSync(path.join(root, "packages", name, "package.json"), path.join(target, "package.json"));
    if (name === "service") fs.cpSync(path.join(root, "packages", name, "bin"), path.join(target, "bin"), { recursive: true });
  }
  assert.equal(fs.existsSync(path.join(runtime, "node_modules", "@mailerport", "sdk")), false);
  const port = await freePort(); const data = path.join(runtime, "data"); fs.mkdirSync(data);
  const child = spawn(process.execPath, [path.join(runtime, "node_modules/@mailerport/service/bin/mailport-service.js")], {
    cwd: runtime, env: { ...process.env, NODE_ENV: "production", PORT: String(port), MAILPORT_API_KEY: "production-key",
      MAILPORT_OUTBOX: path.join(data, "outbox.json"), MAILPORT_OPERATIONS: path.join(data, "operations.json"),
      MAILPORT_TRANSPORT: "smtp", MAILPORT_SMTP_HOST: "smtp.example.test", MAILPORT_SMTP_PORT: "587",
      MAILPORT_SMTP_USERNAME: "username", MAILPORT_SMTP_PASSWORD: "password" }, stdio: ["ignore", "ignore", "pipe"] });
  const errors=[]; child.stderr.on("data",(chunk)=>errors.push(chunk));
  try {
    let health;
    for (let attempt=0;attempt<100;attempt+=1) { try { health=await fetch(`http://127.0.0.1:${port}/health`).then((res)=>res.json());break; }
      catch { await new Promise((resolve)=>setTimeout(resolve,20)); } }
    assert.deepEqual(health,{ok:true},Buffer.concat(errors).toString());
  } finally { child.kill("SIGTERM"); await new Promise((resolve)=>child.once("exit",resolve)); }
});

test("app mail service boots without SDK when service package is present", async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-app-runtime-"));
  for (const name of ["core", "mime", "smtp", "service"]) {
    const target = path.join(runtime, "node_modules", "@mailerport", name); fs.mkdirSync(target, { recursive: true });
    fs.cpSync(path.join(root, "packages", name, "dist"), path.join(target, "dist"), { recursive: true });
    fs.copyFileSync(path.join(root, "packages", name, "package.json"), path.join(target, "package.json"));
    if (name === "service") fs.cpSync(path.join(root, "packages", name, "bin"), path.join(target, "bin"), { recursive: true });
  }
  const appDir = path.join(runtime, "bin"); fs.mkdirSync(appDir, { recursive: true });
  fs.copyFileSync(path.join(root, "bin", "app.js"), path.join(appDir, "app.js"));
  assert.equal(fs.existsSync(path.join(runtime, "node_modules", "@mailerport", "sdk")), false);
  const port = await freePort(); const data = path.join(runtime, "data"); fs.mkdirSync(data);
  const child = spawn(process.execPath, [path.join(runtime, "bin/app.js"), "mail", "service", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: runtime, env: { ...process.env, NODE_ENV: "production", MAILPORT_API_KEY: "production-key",
      MAILPORT_OUTBOX: path.join(data, "outbox.json"), MAILPORT_OPERATIONS: path.join(data, "operations.json"),
      MAILPORT_TRANSPORT: "smtp", MAILPORT_SMTP_HOST: "smtp.example.test", MAILPORT_SMTP_PORT: "587",
      MAILPORT_SMTP_USERNAME: "username", MAILPORT_SMTP_PASSWORD: "password" }, stdio: ["ignore", "ignore", "pipe"] });
  const errors=[]; child.stderr.on("data",(chunk)=>errors.push(chunk));
  try {
    let health;
    for (let attempt=0;attempt<100;attempt+=1) { try { health=await fetch(`http://127.0.0.1:${port}/health`).then((res)=>res.json());break; }
      catch { await new Promise((resolve)=>setTimeout(resolve,20)); } }
    assert.deepEqual(health,{ok:true},Buffer.concat(errors).toString());
  } finally { child.kill("SIGTERM"); await new Promise((resolve)=>child.once("exit",resolve)); }
});
