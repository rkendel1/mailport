import { MailPortError, ERROR_CODES } from "./errors.js";

function parseBlockEntries(block) {
  const entries = {};
  const re = /([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    entries[m[1]] = m[2];
  }
  return entries;
}

function extractNamedBlock(source, name) {
  const match = new RegExp(`\\b${name}\\s*\\{`).exec(source);
  if (!match) return "";
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    i += 1;
  }
  if (depth !== 0) return "";
  return source.slice(start, i - 1);
}

export function parseMailDsl(source) {
  if (!/\buse\s+mail\b/.test(source)) {
    throw new MailPortError(
      ERROR_CODES.MAIL_NOT_CONFIGURED,
      "Missing `use mail` declaration"
    );
  }

  const body = extractNamedBlock(source, "mail");
  const identitiesBlock = extractNamedBlock(body, "identities");
  const templatesBlock = extractNamedBlock(body, "templates");

  return {
    capability: "mail",
    identities: parseBlockEntries(identitiesBlock),
    templates: parseBlockEntries(templatesBlock),
  };
}

export function generateMailContractSnapshot(parsedDsl) {
  return {
    capability: "mail",
    identities: Object.keys(parsedDsl.identities),
    templates: Object.keys(parsedDsl.templates),
  };
}
