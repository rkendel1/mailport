# Direct-MX transport

`direct-mx` is MailPort-owned SMTP delivery to recipient MX servers. It can execute locally on a suitable host or through the authenticated Hetzner worker while Fly retains queue and lifecycle authority. A successful SMTP DATA response means `accepted`, not `delivered`.

The executor resolves ordered MX hosts, attempts STARTTLS when advertised, applies `MAILPORT_MTA_REQUIRE_TLS`, and records bounded evidence: recipient, MX host/address, attempt, connection result, TLS state, SMTP/enhanced code, response, outcome, and timestamp. It never stores bodies, credentials, delivery tokens, or DKIM private keys in logs.

Cloudflare remains available with `MAILPORT_TRANSPORT=cloudflare`; switching to `direct-mx` changes deployment configuration only and never application source or DSL.
