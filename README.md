# Mailerport

Mailerport is a modular transactional-email toolkit for Node.js. Applications use one API while the delivery backend can be switched through configuration: a local inbox for development, SMTP, Cloudflare Email Service, a hosted Mailerport HTTP service, or a self-hosted direct-to-MX worker.

It includes templates and sender identities, a durable outbox with retries and idempotency, domain and suppression operations, delivery events, and test-inbox helpers that never send real email.

> The JavaScript API names (`createMailPort`) and environment-variable prefix (`MAILPORT_*`) remain unchanged for compatibility.

## Requirements

- Node.js 20 or newer
- npm

## Use it in an application

Install the umbrella package:

```sh
npm install mailerport
```

Send a message:

```js
import { createMailPort } from "mailerport";

const mail = createMailPort({
  identities: { auth: "auth@example.com" },
});

await mail.send({
  identity: "auth",
  to: "you@example.com",
  subject: "Welcome",
  text: "Welcome to the application.",
});

await mail.close();
```

Without remote or production transport configuration, this uses the local transport. To submit through a deployed Mailerport service, set:

```sh
export MAILPORT_URL=https://mail.example.com
export MAILPORT_API_KEY=replace-with-application-secret
```

`createMailPort()` detects these variables and uses the remote service, keeping its URL and credentials out of application code.

## Templates and capability declarations

Declare identities and templates in a mail capability file:

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

Register that capability with a compatible host:

```js
import { registerMailCapability } from "mailerport";

registerMailCapability(capabilityRegistry);
```

## Local development and testing

Use the deterministic test inbox when tests need to inspect messages without delivering them:

```js
import { createMailPort } from "@mailerport/sdk";

const mail = createMailPort({
  transport: "local",
  identities: { auth: "auth@example.com" },
  testEndpointsEnabled: true,
});

await mail.send({
  identity: "auth",
  to: "user@example.com",
  subject: "Verify your account",
  text: "Your code is 123456.",
});

const message = await mail.test.waitFor({ to: "user@example.com" });
console.log(message);
mail.test.clear();
```

The test API supports `list`, `get`, filtered `clear`, and `waitFor`.

From this repository, install dependencies and run the local inbox UI:

```sh
npm install
npm run app -- mail dev
```

Open <http://127.0.0.1:8788/mail>. To send a local test message from another terminal:

```sh
npm run app -- mail send \
  --to user@example.com \
  --from system \
  --subject "Hello" \
  --text "Sent by Mailerport"
```

## Run the HTTP service

For a local service with a persistent outbox:

```sh
npm run app -- mail service \
  --host 127.0.0.1 \
  --port 8789 \
  --api-key local-secret \
  --outbox .mailport/outbox.json
```

Then set `MAILPORT_URL=http://127.0.0.1:8789` and `MAILPORT_API_KEY=local-secret` in the application. Production requires an absolute persistent outbox path and a configured transport. Copy `.env.example` as a starting point; never commit real credentials.

Supported `MAILPORT_TRANSPORT` values are `local`, `smtp`, `cloudflare`, and `direct-mx`. See [production deployment](docs/deployment.md), [Cloudflare transport](docs/transports/cloudflare.md), or [direct-to-MX transport](docs/transports/direct-mx.md) for backend-specific setup.

## Repository development

```sh
npm install
npm test
npm run build --workspaces
```

Useful scripts:

- `npm test` runs the Node test suite.
- `npm run build --workspaces` builds every publishable package.
- `npm run pack:all` creates local package archives.
- `npm run app -- mail status` shows local or remote service status.

## Packages

- `mailerport` — application-facing umbrella package
- `@mailerport/core` — contracts, errors, and capability metadata
- `@mailerport/sdk` — application SDK and remote client
- `@mailerport/mime` — MIME and DKIM primitives
- `@mailerport/smtp` — SMTP and direct-MX transports
- `@mailerport/testing` — deterministic transport and inbox helpers
- `@mailerport/service` — independently deployable HTTP service

SMTP and service runtime code are intentionally absent from the `mailerport` and `@mailerport/sdk` dependency graphs.
