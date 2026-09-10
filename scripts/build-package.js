import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageName = process.argv[2];
if (!packageName) throw new Error("Missing package name");
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(workspaceRoot, "packages", packageName);
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
fs.cpSync(path.join(root, "src"), path.join(root, "dist"), { recursive: true });
