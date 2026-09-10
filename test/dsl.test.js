import test from "node:test";
import assert from "node:assert/strict";
import { parseMailDsl, generateMailContractSnapshot } from "../src/dsl.js";

test("parseMailDsl parses identities and templates", () => {
  const source = `
use mail
mail {
  identities {
    system = "notifications@myapp.com"
    auth = "auth@myapp.com"
  }
  templates {
    verify-email = "./emails/verify-email.html"
    password-reset = "./emails/password-reset.html"
  }
}
`;
  const parsed = parseMailDsl(source);
  assert.equal(parsed.capability, "mail");
  assert.equal(parsed.identities.system, "notifications@myapp.com");
  assert.equal(parsed.templates["verify-email"], "./emails/verify-email.html");

  const snapshot = generateMailContractSnapshot(parsed);
  assert.deepEqual(snapshot, {
    capability: "mail",
    identities: ["system", "auth"],
    templates: ["verify-email", "password-reset"],
  });
});
