# Self-hosted direct delivery

MailPort can deliver directly to recipient MX servers without SES, Resend, SendGrid, or another mail-delivery provider. Set `MAILPORT_TRANSPORT=direct-mx`.

This mode requires infrastructure with a stable dedicated egress IP and operator-controlled reverse DNS. Before startup:

1. Assign a stable IPv4 address to the MailPort host.
2. Set its PTR record to the value of `MAILPORT_MTA_HOSTNAME`, such as `mail.example.com`.
3. Publish an A record for that hostname pointing back to the same IP.
4. Set `MAILPORT_EGRESS_IP` to the expected IP. This declares identity; it does not configure network routing.
5. Optionally set `MAILPORT_EGRESS_IP_CHECK_URL` to an operator-controlled endpoint that returns the caller's public IP as plain text or `{ "ip": "..." }`. Startup then fails if observed and declared egress differ.
6. Generate a 32-byte encryption key and store it as `MAILPORT_KEY_ENCRYPTION_KEY` in the platform secret manager.
7. Mount durable storage for the outbox, operational state, and encrypted signing-key store.

MailPort fails startup unless the PTR and forward address agree (forward-confirmed reverse DNS, or FCrDNS). Its generated SPF recommendation authorizes the declared egress IP. If the domain already has SPF, merge the displayed `ip4:` or `ip6:` mechanism into its single existing `v=spf1` record; never publish a second SPF record or blindly replace other senders. Keep SPF's 10-DNS-lookup limit in mind when using `include` mechanisms. MailPort accepts a merged SPF record during verification. Domain ownership, SPF, DKIM, and DMARC must all verify before an identity becomes active.

DKIM uses a distinct selector and key pair for each domain. The public key is returned for DNS setup; the private key is written only to the encrypted durable signing-key store and is never returned by the API or CLI after creation.

`MAILPORT_MTA_REQUIRE_TLS=false` is the interoperable direct-MX default because receiving domains are not universally required to offer STARTTLS. MailPort attempts STARTTLS whenever advertised. A receiver that does not advertise STARTTLS may receive plaintext; a failed negotiation after STARTTLS was advertised fails that delivery attempt instead of silently downgrading it. Set the option to `true` to also reject receivers that do not advertise STARTTLS.

Fly Machines can host the MailPort API and durable queue, but direct-MX delivery requires an egress environment where the operator controls the public sending IP and its PTR. If the chosen Fly networking configuration does not provide that control, run the direct-MX worker on infrastructure that does, or have MailPort submit to an operator-controlled MTA. This is an infrastructure constraint, not an application API change.
