# Cloudflare Email Service transport

The Cloudflare adapter is a replaceable production transport. It does not change MailPort application code, the DSL, identities, templates, or primary message IDs.

## Setup

1. Use Cloudflare DNS for the sending domain and [onboard it in Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/).
2. Create an API token with the `Email Sending: Edit` permission.
3. Store these as deployment secrets:

```text
MAILPORT_TRANSPORT=cloudflare
MAILPORT_CLOUDFLARE_ACCOUNT_ID=...
MAILPORT_CLOUDFLARE_API_TOKEN=...
```

`MAILPORT_CLOUDFLARE_BASE_URL` defaults to `https://api.cloudflare.com/client/v4`. Missing credentials fail startup. Tokens are not written to messages, delivery metadata, errors, status output, contract snapshots, or service configuration.

Cloudflare owns provider domain onboarding and its associated DNS records. MailPort does not mutate Cloudflare DNS. Sender-domain rejection is normalized as a permanent provider failure.

## Lifecycle

A successful REST submission means Cloudflare accepted the message. MailPort records `status: "accepted"`, `provider: "cloudflare"`, and the separate `providerMessageId`; it does not infer recipient delivery. Throttling, server errors, and network failures use the durable retry/backoff machinery. Authentication and other request rejections are permanent.

Use `app mail transport status` to inspect configuration without revealing credentials. `app mail send` uses `MAILPORT_URL` when configured, so it submits through the deployed MailPort transport.

Switching backends only changes deployment configuration: `MAILPORT_TRANSPORT=local`, `cloudflare`, `smtp`, or `direct-mx`. Application source and DSL remain unchanged. Consult Cloudflare's [REST API documentation](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/) for the current provider contract.
