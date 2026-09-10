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

## Run tests

```bash
npm test
```