# Hetzner direct-MX deployment

Fly remains the MailPort control plane, durable outbox, retry authority, and lifecycle store. Hetzner runs only the authenticated direct-MX execution process from [`deploy/hetzner`](../../deploy/hetzner/README.md). Cloudflare remains an alternative `cloudflare` transport. The Hetzner server is shared infrastructure: `/opt/grabit` is a protected existing workload and must never be modified. Inventory it read-only before and after, place all MailPort resources below `/opt/mailport`, deploy only the isolated `mailport-direct-mx` container, and leave existing software, containers, services, firewall, routes, public listeners, and host runtimes untouched.

After the isolated worker and outbound TCP/25 have been proven, use the dedicated server IPv4 address. Publish `A mail.agenttrustvault.com <IP>` and configure the same IP's PTR in Hetzner Robot as `mail.agenttrustvault.com`. Require forward-confirmed reverse DNS before sender-authentication changes:

```sh
dig +short A mail.agenttrustvault.com
dig +short -x HETZNER_IP
```

The worker must reach recipient MX servers on outbound TCP/25; it never listens on port 25. By default its HTTP endpoint binds only to `127.0.0.1:8799`. The signing-key file is encrypted durable secret material; it is not a message store. Fly and Hetzner use the same current domain key during a direct-MX deployment, but the private key is never included in a delivery job.

Hetzner blocks outbound ports 25 and 465 by default. The account owner must enable port 25 in the administration interface when eligible or request an unblock through support. Keep the worker localhost-only and do not change UFW to address an upstream port block.

For a dedicated server, set reverse DNS in Hetzner Robot under the server's **IPs** tab. PTR is managed by Hetzner, not by adding a PTR record to the sender domain's DNS zone.

Configure Fly with `MAILPORT_TRANSPORT=direct-mx`, `MAILPORT_DIRECT_MX_WORKER_URL=https://mail.agenttrustvault.com`, `MAILPORT_DELIVERY_TOKEN`, and `MAILPORT_KEY_ENCRYPTION_KEY`. Fly owns all retries. The Hetzner response supplies normalized SMTP evidence that Fly stores with the authoritative message.

Use a dedicated test identity first. Only after isolation, unchanged-host inventory, TCP/25, PTR and FCrDNS pass may production sender authentication change: ensure exactly one SPF TXT record authorizes the Hetzner IP, create a fresh MailPort DKIM key in the encrypted store and publish only its public record, and merge an initial `p=none` DMARC policy rather than overwriting an existing policy. Fail deployment if more than one `v=spf1` record exists.
