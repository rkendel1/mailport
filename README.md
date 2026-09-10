# MailPort

Install MailPort and send transactional mail through a local or remote MailPort service:

```sh
npm install mailerport
```

```js
import { createMailPort } from "mailerport";

const mail = createMailPort();
await mail.send({
  identity: "auth",
  to: "you@example.com",
  subject: "Welcome",
  text: "Welcome to the application.",
});
```

With `MAILPORT_URL=https://mail.example.com` and `MAILPORT_API_KEY=...`, `createMailPort()` automatically uses the remote service. Deployment URLs and credentials stay out of application source.

## Declare the capability

```text
use mail
mail {
  identities {
    auth = "auth@example.com"
  }
  templates {
    verify = "./emails/verify.html"
  }
}
```

MailPort exports a registry-friendly capability rather than requiring mail-specific logic in a DSL host:

```js
import { registerMailCapability } from "mailerport";
registerMailCapability(capabilityRegistry);
```

## Local testing

```js
import { createMailPort } from "@mailerport/sdk";
import { createTestInbox } from "@mailerport/testing";

const mail = createMailPort({
  transport: "local",
  identities: { auth: "auth@example.com" },
  testEndpointsEnabled: true,
});
const inbox = createTestInbox();
```

The deterministic test API supports `list`, `get`, isolated `clear`, and `waitFor` queries.

## Packages

- `mailerport`: application-facing umbrella
- `@mailerport/core`: contracts, errors, and DSL capability metadata
- `@mailerport/sdk`: application SDK and remote client
- `@mailerport/mime`: MIME and DKIM primitives
- `@mailerport/smtp`: optional SMTP transport
- `@mailerport/testing`: deterministic transports and inbox helpers
- `@mailerport/service`: independently deployable HTTP service

SMTP and service runtime code are deliberately absent from `mailerport` and `@mailerport/sdk` dependency graphs.

## Development

```sh
npm install
npm test
npm run build --workspaces
```

Production deployment guidance is in [docs/deployment.md](docs/deployment.md).
