# Hetzner direct-MX worker

This artifact runs only MailPort's authenticated delivery executor. It has no message database, outbox, retry scheduler, administration API, Studio, or inbound SMTP relay.

This is a shared-host deployment. `/opt/grabit` is an existing protected workload and is completely off-limits. MailPort is a guest: do not read application secrets, write anywhere below `/opt/grabit`, install host packages, alter existing application directories or systemd units, restart Docker, reboot, change firewall/routes, or claim ports already in use.

1. Create only `/opt/mailport/{direct-mx/app,direct-mx/config,data,logs,secrets}` and make it owned by the deployment user. Do not create MailPort paths under `/opt/grabit`.
2. Copy only `compose.yaml` and `inventory.sh` into `/opt/mailport/direct-mx/app`. Build the image off-host, transfer a compressed image archive into that directory, load it with `docker load`, then remove the archive after confirming the image exists. Do not copy the repository or install Node on the host.
3. Run `./inventory.sh /opt/mailport/logs/baseline.txt` before making any other host changes and retain the mode-0600 baseline. Inventorying `/opt/grabit` is read-only; do not open or copy its application files or secrets.
4. Inspect the baseline, especially listeners, containers, routes, Docker disk use, `/opt/grabit`, disk and memory. Stop if `127.0.0.1:8799` is occupied or capacity is insufficient.
5. Put the worker environment only at `/opt/mailport/secrets/mailport.env`, mode `0600`. Keep non-secret configuration in `/opt/mailport/direct-mx/config`.
6. Make `/opt/mailport/data` owned by uid/gid 1000 with mode `0700`. Securely copy the encrypted signing-key store to `/opt/mailport/data/signing-keys.json` and use its matching encryption key. Never print or commit the private key.
7. Start only this project with `docker compose --project-name mailport-direct-mx up -d`. Do not build on-host, restart the Docker daemon, or touch unrelated containers.
8. Run `./inventory.sh /opt/mailport/logs/after.txt` and compare with the baseline. The only expected additions are container/image `mailport-direct-mx`, bounded Docker log/storage use, and listener `127.0.0.1:8799`. Existing containers, services, public ports, addresses, routes, and `/opt/grabit` metadata/layout must be unchanged.
9. Verify health locally with `curl http://127.0.0.1:8799/health` and authenticated diagnostics through an SSH tunnel. Verify outbound TCP/25 before any DNS changes.

Build the image on a development/build machine with `docker build --platform linux/amd64 -f deploy/hetzner/Dockerfile -t mailport-direct-mx:0.1.0 .`. The Compose definition can be validated without production secrets using `MAILPORT_ENV_FILE=.env.example docker compose config --quiet` from the repository.

Hetzner blocks outbound ports 25 and 465 by default. Enable port 25 in the Hetzner administration interface when eligible, or request an unblock through Hetzner support, before attempting SMTP acceptance tests. Do not work around this with host firewall changes or a third-party relay.

The worker binds only to host loopback on port 8799 and never binds local port 25. It is an outbound SMTP client. Do not add Caddy, change firewall rules, or reuse an existing proxy until its configuration and ownership have been inventoried. Fly connectivity requires a separately reviewed TLS path—prefer attaching a route to an existing proxy without changing its current listeners, or a private network/tunnel. Keep bearer authentication even on a private path. Rotate delivery credentials by setting both the new `MAILPORT_DELIVERY_TOKEN` and old `MAILPORT_DELIVERY_TOKEN_PREVIOUS`, updating Fly, then removing the previous token.

The executor makes one delivery attempt and returns evidence. It never retries locally. SMTP has an unavoidable ambiguous case when a recipient accepts DATA but the connection drops before its response reaches the worker; MailPort does not claim exactly-once Internet delivery.

After deployment, configure the same worker URL and delivery token in the operator environment:

```sh
app mail direct-mx status
app mail direct-mx verify --to you@external-domain.example
app mail direct-mx test --to you@external-domain.example --from auth
```

The test command submits through the Fly MailPort API, so `MAILPORT_URL` and a MailPort API/admin key must also be configured. It does not bypass the durable outbox. Initially use a dedicated test identity/domain. Do not update production SPF, DKIM, DMARC, or `mail.agenttrustvault.com` until isolation, before/after inventory, outbound TCP/25, and PTR/FCrDNS are proven.
