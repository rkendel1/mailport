# mailport

Minimal MailPort foundation implementing:

- `use mail` DSL parsing + contract snapshot generation
- in-memory/local transactional send API with idempotency keys
- message lifecycle (`accepted` → `queued` → `sent|failed`)
- deterministic test API (`list/get/clear/waitFor`)
- local inbox + test endpoints:
  - `GET /mail`
  - `GET /v1/test/messages`
  - `GET /v1/test/messages/:id`
  - `DELETE /v1/test/messages`
- remote MailPort service + authenticated SDK transport (`transport: "remote"`)
- optional durable outbox (`outbox.enabled` + `outbox.filePath`) with async worker retries

## Run tests

```bash
npm test
```

## Run remote MailPort service

```bash
app mail service --port 8789 --api-key dev-key
```