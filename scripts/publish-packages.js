import { spawnSync } from "node:child_process";
import process from "node:process";

const packages = [
  "@mailerport/core", "@mailerport/sdk", "@mailerport/mime",
  "@mailerport/testing", "@mailerport/smtp", "@mailerport/service", "mailerport",
];
const version = "0.1.0";

console.log("Opening npm's browser login…");
const login = spawnSync("npm", ["login", "--auth-type=web"], { stdio: "inherit" });
if (login.status !== 0) process.exit(login.status || 1);

const identity = spawnSync("npm", ["whoami"], { encoding: "utf8" });
if (identity.status !== 0) {
  console.error("npm login did not produce a valid CLI session.");
  process.exit(1);
}
console.log(`Authenticated as ${identity.stdout.trim()}.`);

for (const packageName of packages) {
  const published = spawnSync("npm", ["view", `${packageName}@${version}`, "version"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  if (published.status === 0 && published.stdout.trim() === version) {
    console.log(`skip ${packageName}@${version} (already published)`);
    continue;
  }

  console.log(`publish ${packageName}@${version}`);
  const result = spawnSync("npm", ["publish", `--workspace=${packageName}`, "--access=public"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("\nIf npm reported EOTP, browser login is not sufficient for this account's publish policy.");
    console.error("Create a granular read/write token with ‘Bypass 2FA’ enabled at:");
    console.error("https://www.npmjs.com/settings/rkendel/tokens/granular-access-tokens/new");
    console.error("Then configure that token for npm and rerun this command.");
    process.exit(result.status || 1);
  }
}

console.log(`Published all MailPort packages at ${version}.`);
