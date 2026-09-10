# Production deployment

MailPort's HTTP API is deployment-neutral. `fly.toml` is one deployment recipe; applications continue to use `MAILPORT_URL` and `MAILPORT_API_KEY` over HTTPS.

## Storage boundary

`FileMailStore` is appropriate for development and for a single-machine deployment backed by a persistent Fly volume. Atomic commits survive process crashes, but a volume is tied to a region and is not a replicated database. Machine-local or ephemeral storage is not production durability. For multi-region or stronger availability, provide a durable `MailStore` implementation backed by SQLite replication, Postgres, or another authoritative database.

Create and attach the volume before deployment:

```sh
fly volumes create mailport_data --region iad
fly secrets set MAILPORT_API_KEY=... MAILPORT_ADMIN_KEY=... MAILPORT_SMTP_HOST=... MAILPORT_SMTP_PORT=587 MAILPORT_SMTP_USERNAME=... MAILPORT_SMTP_PASSWORD=... MAILPORT_DKIM_DOMAIN=... MAILPORT_DKIM_PRIVATE_KEY=...
fly deploy
```

Production startup rejects missing API, outbox, transport, and SMTP settings; development-style API keys; and relative outbox paths. Fly terminates TLS at the edge and forwards to the private service port. `force_https` redirects public HTTP traffic.

## Domain authentication

Run `app mail domain add example.com` with `MAILPORT_URL` and `MAILPORT_ADMIN_KEY` configured. Publish the returned SPF and DKIM TXT records and the recommended DMARC TXT record. MailPort never edits DNS. After public DNS propagation, run `app mail domain verify example.com` and inspect `app mail domains`.

Provider-managed DKIM can be configured with `MAILPORT_DKIM_CNAME_TARGETS` (comma-separated), while `MAILPORT_SPF_VALUE` and `MAILPORT_DMARC_VALUE` supply the exact provider-authorized policies. Without CNAME targets, MailPort emits its signer public key as a DKIM TXT record. Ownership, every DKIM record, SPF, and DMARC are resolved independently; a domain is not active until all are present.

DKIM private material belongs in Fly secrets or another secret manager. It is never returned by domain, status, message, or event endpoints. Set `MAILPORT_DKIM_DOMAIN` and `MAILPORT_DKIM_PRIVATE_KEY` on every service instance that sends for an active domain.

## Delivery semantics

SMTP `250` after `DATA` transitions a message to `sent`: the relay accepted responsibility. It does not mean the recipient received it. Only an authenticated downstream delivery event may transition it to `delivered`, `bounced`, or `complained`. A hard bounce or complaint creates a suppression; transient SMTP failures only schedule retries.

## Operational checks

- `/health` reports that the process is alive.
- `/ready` verifies durable-store access and, in production, signing-key availability for active domains. It intentionally does not require the SMTP relay to be reachable.
- `/v1/status` exposes queue, volume, and transport counters without credentials or message contents.

Use `app mail status`, `domains`, `identities`, `logs --message <id>`, and `suppressions`; these commands call the remote API and never edit storage files.

## External acceptance

The final SMTP/DNS/mailbox proof is necessarily environment-specific. Use a dedicated test domain and mailbox, require TLS, publish the exact returned records, send through the HTTPS endpoint, download the received raw message, and validate its DKIM signature with an independent verifier. Also stop the relay temporarily to confirm the message remains `retrying`, then restore it and confirm `sent`. Do not treat a test that merely finds a `DKIM-Signature` header as end-to-end validation.

For provider-free direct-to-MX delivery, follow [self-hosted-mta.md](self-hosted-mta.md). That mode requires dedicated egress and PTR control and therefore cannot be operated correctly from Fly alone.
