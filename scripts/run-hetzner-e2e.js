import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnvironment = path.join(root, ".env.local");
if (fs.existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mailport-hetzner-e2e-"));
const application = path.join(temporary, "app");
const tarballs = path.join(temporary, "packages");
const commandEnvironment = { ...process.env, npm_config_cache: path.join(temporary, "npm-cache") };
fs.cpSync(path.join(root, "fixtures/hetzner-mail-app"), application, { recursive: true,
  filter: (source) => !source.endsWith(`${path.sep}node_modules`) && !source.includes(`${path.sep}node_modules${path.sep}`) });
fs.mkdirSync(tarballs);
for (const name of ["core", "mime", "sdk", "smtp"])
  execFileSync("npm", ["pack", path.join(root, "packages", name), "--pack-destination", tarballs],
    { stdio: "inherit", env: commandEnvironment });
const archives = fs.readdirSync(tarballs).map((name) => path.join(tarballs, name));
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives],
  { cwd: application, stdio: "inherit", env: commandEnvironment });
for (const name of ["core", "sdk", "smtp"]) {
  const installed = fs.realpathSync(path.join(application, "node_modules/@mailerport", name));
  if (installed.includes(root)) throw new Error("External fixture resolved a package from the MailPort repository");
}
execFileSync(process.execPath, ["--input-type=module", "-e",
  "await Promise.all(['@mailerport/core','@mailerport/sdk','@mailerport/smtp'].map((name) => import(name)))"],
{ cwd: application, stdio: "inherit" });
console.log("✓ clean packaged runtime");
if (process.env.MAILPORT_E2E_INSTALL_ONLY === "true") process.exit(0);
execFileSync(process.execPath, ["app.js"], { cwd: application, env: process.env, stdio: "inherit" });
