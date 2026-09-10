Yes. And because AuthBoundry is going to generate a lot of verification, reset, invitation, recovery, and lifecycle email, I would design this as a real infrastructure capability rather than a thin SMTP wrapper.

The key architectural decision is:

MailPort is the durable transactional-mail capability. Applications declare use mail; they never know whether delivery is SMTP, a local test transport, or the production MailPort service.

Below is the spec I would hand to the coding agent.

MailPort

Transactional Email Infrastructure & Application DSL

Status: Implementation Specification
Version: 1.0
Primary use: AppBoundry, AuthBoundry, FeltDB, and future products
Deployment target: Fly.io
Initial scope: Outbound transactional email
Non-goal: Human mailbox hosting / IMAP / webmail

⸻

1. Purpose

MailPort is a centralized transactional-email capability that allows all products and applications to send email through one stable application-facing contract.

Applications must not directly integrate with:

* Resend
* SendGrid
* Postmark
* Mailgun
* SES
* Nodemailer
* arbitrary SMTP servers
* provider-specific SDKs

Instead, an application declares:

use mail

and consumes a stable MailPort API.

The underlying delivery implementation is replaceable.

The application depends on the capability, not the mail provider.

⸻

2. Design Principles

2.1 Capability over provider

Application source declares:

use mail

It must never need to know:

SMTP
SES
Resend
Postmark
SendGrid

Those are implementation details.

⸻

2.2 One MailPort for many applications

A single MailPort deployment may serve:

AuthBoundry
AppBoundry
FeltDB
Knowledge products
Developer tools
Future applications

Each application remains isolated through:

* application identity
* tenant identity where applicable
* authorized sender identities
* credentials
* rate limits
* audit records

⸻

2.3 Local development must be first-class

Local development must not require real email delivery.

Developers must be able to run:

app mail dev

and receive emails through a local inbox/test interface.

Example:

http://127.0.0.1:8788/mail

This is particularly important for AuthBoundry.

A developer should be able to repeatedly test:

* signup
* email verification
* password reset
* magic links
* invitations
* account recovery
* MFA enrollment
* MFA recovery
* email change
* login notifications
* account lifecycle events

without sending hundreds of emails to real addresses.

⸻

3. Architecture

┌─────────────────────────────┐
│ Application                 │
│                             │
│ use mail                    │
│                             │
│ mail.send(...)              │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ MailPort Contract           │
│                             │
│ authorization               │
│ application identity        │
│ templates                   │
│ identities                  │
│ idempotency                 │
│ observability               │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ MailPort Service            │
│                             │
│ API                         │
│ durable outbox              │
│ scheduler                   │
│ delivery workers            │
│ retry engine                │
│ bounce processing           │
│ suppression                 │
│ audit                       │
└──────────────┬──────────────┘
               │
        ┌──────┴────────┐
        ▼               ▼
 Local/Test         Production
 Transport          SMTP/MTA
        │               │
        ▼               ▼
 Test Inbox          Internet

⸻

4. Application DSL

The minimal declaration is:

use mail

This declares that the application requires the Mail capability.

⸻

5. Mail Configuration

Example:

use mail
mail {
  identities {
    system = "notifications@myapp.com"
    auth = "auth@myapp.com"
    billing = "billing@myapp.com"
  }
  templates {
    welcome = "./emails/welcome.html"
    verify = "./emails/verify.html"
    reset = "./emails/reset.html"
    invitation = "./emails/invitation.html"
  }
}

⸻

6. Identity Model

A Mail identity is a logical sender.

Example:

identities {
  system = "notifications@myapp.com"
  auth = "auth@myapp.com"
  billing = "billing@myapp.com"
}

Applications reference:

system
auth
billing

rather than hardcoding sender configuration throughout source code.

The MailPort service resolves the logical identity.

⸻

7. Identity Metadata

The service must support:

identity
application_id
tenant_id
email_address
display_name
domain
status
verified
created_at
updated_at

Example:

{
  "identity": "auth",
  "email": "auth@myapp.com",
  "displayName": "MyApp Security",
  "status": "active",
  "verified": true
}

⸻

8. Templates

Templates are optional.

Applications may send explicit content, but templates are preferred for recurring transactional events.

Example:

templates {
  welcome = "./emails/welcome.html"
  verify = "./emails/verify.html"
  reset = "./emails/reset.html"
}

A template should support:

subject
html
text
variables

Example conceptual template:

subject = "Verify your email"
Hello {{name}},
Verify your account:
{{verification_url}}

⸻

9. Template Security

Template rendering must prevent:

* arbitrary filesystem access
* template execution
* code execution
* environment-variable disclosure
* access to unrelated application files

Variables are data only.

Template expressions must not execute application code.

⸻

10. Sending API

The SDK should expose:

await mail.send(...)

Two forms are required.

Template form

await mail.send("verify", {
  identity: "auth",
  to: user.email,
  variables: {
    name: user.name,
    verification_url: url
  }
})

Explicit form

await mail.send({
  identity: "system",
  to: "user@example.com",
  subject: "Your report is ready",
  html: "<p>Your report is ready.</p>",
  text: "Your report is ready."
})

⸻

11. Recipient Model

Support:

to
cc
bcc
reply_to

Each recipient must be represented independently internally.

The initial API may accept:

to: string

or:

to: string[]

⸻

12. Attachments

Attachments are supported by the contract but may be limited in the first delivery implementation.

Required model:

{
  filename: "invoice.pdf",
  contentType: "application/pdf",
  content: ...
}

Do not make attachments dependent on filesystem paths.

The service must enforce:

* maximum message size
* maximum attachment size
* maximum attachment count

⸻

13. Idempotency

This is especially important for AuthBoundry.

Every send operation should optionally accept:

idempotencyKey

Example:

await mail.send("reset", {
  identity: "auth",
  to: user.email,
  variables: {...},
  idempotencyKey: `password-reset:${reset.id}`
})

Repeated requests with the same idempotency key must not create duplicate messages.

⸻

14. Message Identity

Every accepted message receives:

message_id

Example:

msg_01J...

The message ID is stable for the lifetime of the message.

⸻

15. Message Lifecycle

Messages have explicit lifecycle states:

accepted
queued
processing
sent
delivered
failed
retrying
bounced
suppressed
cancelled

The initial implementation may distinguish:

accepted
queued
sent
failed

but the data model should not prevent later delivery-state expansion.

⸻

16. Durable Outbox

MailPort must use a durable outbox.

The API must not report successful acceptance until the message is durably recorded.

Conceptually:

API request
    ↓
validate
    ↓
authorize
    ↓
persist message
    ↓
commit
    ↓
return message_id
    ↓
worker delivers

Never:

API request
    ↓
SMTP immediately
    ↓
hope nothing crashes

⸻

17. Retry Model

Transient delivery failures must be retried.

The retry engine should support:

attempt
next_attempt_at
last_error
retry_count

Use exponential backoff with jitter.

Permanent failures must not retry indefinitely.

⸻

18. Dead Letter

Messages that cannot be delivered after the configured retry policy move to:

failed

and remain inspectable.

The service must retain:

message_id
application_id
recipient
attempts
last error
timestamps

⸻

19. Test Transport

This is critical.

MailPort must have a deterministic test transport.

Example:

app mail test

or:

FELTDB_MAIL_TRANSPORT=memory

The exact environment variable name can be finalized during implementation, but transport selection must be configuration-driven.

Supported initial transports:

memory
local
smtp

⸻

20. Memory Transport

Memory transport never sends real email.

Messages are retained in process memory.

It should support:

mail.test.list()
mail.test.get(messageId)
mail.test.clear()

This enables unit and integration tests.

⸻

21. Local Inbox

Local development should provide an inbox UI.

Example:

http://127.0.0.1:8788/mail

The inbox displays:

Recipient
From
Subject
Timestamp
Status
Message ID

Opening a message displays:

HTML
Text
Headers
Metadata
Template
Application

⸻

22. AuthBoundry Test Workflow

This should be explicitly supported.

Example:

authboundry dev

Then:

POST /signup
     ↓
AuthBoundry creates verification token
     ↓
MailPort sends verification email
     ↓
local inbox receives email
     ↓
test extracts verification URL
     ↓
browser follows URL

The developer should not need to copy/paste emails from a real mailbox.

⸻

23. Test Mail API

Provide a testing API such as:

GET /v1/test/messages
GET /v1/test/messages/:message_id
DELETE /v1/test/messages

Optional filtering:

GET /v1/test/messages?to=user@example.com
GET /v1/test/messages?subject=password
GET /v1/test/messages?template=reset

Test endpoints must only exist in explicitly enabled development/test environments.

They must never be exposed accidentally in production.

⸻

24. Test Assertions

The SDK should eventually support:

const email = await mail.test.waitFor({
  template: "reset",
  to: user.email
})
expect(email).toExist()
expect(email.subject).toContain("Reset")

And:

expect(email).toContainLink("/reset/")

This is particularly valuable for AuthBoundry integration tests.

⸻

25. Email Extraction

For automated AuthBoundry tests, provide a deterministic way to retrieve links.

Example:

const email = await mail.test.waitFor({
  to: user.email,
  template: "verify"
})
const url = email.links[0]

The system should parse links from HTML/text.

Do not require the test to understand HTML.

⸻

26. Domain Model

MailPort manages domains independently from applications.

Example:

myapp.com
appboundry.com
feltdb.com
authboundry.com

Each domain has:

domain
status
verification status
SPF status
DKIM status
DMARC status

⸻

27. Domain Authorization

An application may only send from identities it has been authorized to use.

For example:

AuthBoundry
  └── auth@authboundry.com
AppBoundry
  └── notifications@appboundry.com

An application must not be able to arbitrarily send:

ceo@another-company.com

by changing its request payload.

⸻

28. Production SMTP

Production MailPort should support an outbound MTA/SMTP implementation.

The application does not know or care what the MTA is.

Initial deployment can use:

MailPort
   ↓
SMTP
   ↓
internet

The SMTP credentials live only in MailPort infrastructure.

They must never appear in application repositories.

⸻

29. Configuration

Deployment configuration may contain:

MAILPORT_URL
MAILPORT_TOKEN

The application DSL should not contain secrets.

Likewise, SMTP configuration must remain infrastructure-only.

⸻

30. Configuration Resolution

Follow the same philosophy as the existing application deployment configuration:

explicit configuration
    ↓
environment
    ↓
project configuration
    ↓
runtime detection

Do not create application-specific provider branches.

⸻

31. Local vs Production

Local:

Application
 ↓
MailPort
 ↓
Memory/Local transport
 ↓
Test inbox

Production:

Application
 ↓
MailPort
 ↓
durable outbox
 ↓
SMTP/MTA
 ↓
Internet

The application code remains identical.

⸻

32. Authorization

Every MailPort request must carry application identity.

Conceptually:

application_id
tenant_id
principal
capability

MailPort validates that the caller is allowed to:

send
use identity
use template
access test inbox
read message status

⸻

33. No Open Relay

This is mandatory.

MailPort must never operate as an unauthenticated relay.

Every production send must have:

authenticated caller
authorized application
authorized sender identity
authorized recipient operation

⸻

34. Rate Limits

Rate limiting must exist at multiple levels:

application
tenant
sender identity
recipient
domain

This prevents:

* accidental loops
* compromised applications
* runaway tests
* malicious use
* provider/domain reputation damage

⸻

35. Development Rate Limits

Development/test environments should permit high throughput.

AuthBoundry testing should be able to generate hundreds or thousands of messages without fighting production-oriented limits.

Example:

production:
  conservative limits
test:
  effectively unlimited within machine/resource limits

⸻

36. Suppression

Production MailPort should maintain suppression state for addresses that repeatedly bounce or otherwise must not receive mail.

Model:

email
reason
source
created_at
updated_at

Reasons may include:

hard_bounce
complaint
manual
invalid

⸻

37. Bounce Handling

The architecture must allow bounce events to be fed back into MailPort.

The first implementation may not fully automate inbound bounce processing, but the message model must support:

bounce
delivery failure
complaint

⸻

38. Audit

Every send must produce an auditable record.

Minimum:

message_id
application_id
tenant_id
sender_identity
recipient
subject
template
status
created_at
updated_at

Do not store unnecessary sensitive message content in audit records.

⸻

39. Privacy

Email content may contain sensitive information.

Therefore:

* content access must be authorized
* production logs must not contain full message bodies by default
* SMTP credentials must never be logged
* authorization tokens must never be logged
* test inbox must be explicitly scoped
* retention must be configurable

⸻

40. Observability

Expose metrics such as:

messages accepted
messages queued
messages sent
messages failed
messages retrying
delivery latency
queue depth
bounce count
suppression count

Application-level metrics should be filterable by:

application_id
template
identity

⸻

41. CLI

Initial CLI:

app mail status
app mail test
app mail send
app mail logs
app mail domains
app mail identities

Development:

app mail dev

Testing:

app mail test inbox
app mail test clear
app mail test wait

⸻

42. app mail send

Provide a CLI for smoke testing.

Example:

app mail send \
  --to user@example.com \
  --from system \
  --subject "MailPort test" \
  --text "MailPort is working."

The CLI should resolve the configured MailPort capability.

⸻

43. app mail status

Should show:

MailPort
──────────────
Endpoint: connected
Transport: smtp
Queue: 0
Workers: 2
Domains
──────────────
myapp.com       verified
appboundry.com  verified
Health
──────────────
API             OK
Queue           OK
Delivery        OK

⸻

44. API

Initial API:

POST /v1/messages
GET  /v1/messages/:id
GET  /v1/messages

Testing:

GET    /v1/test/messages
GET    /v1/test/messages/:id
DELETE /v1/test/messages

Administration:

GET /v1/domains
GET /v1/identities
GET /v1/templates

Health:

GET /health
GET /ready

⸻

45. SDK

Expose:

mail.send(...)
mail.get(...)
mail.list(...)

Testing:

mail.test.waitFor(...)
mail.test.get(...)
mail.test.list(...)
mail.test.clear()

The testing API should only be compiled/exposed when the environment permits it.

⸻

46. Error Model

Use stable machine-readable errors.

Examples:

MAIL_NOT_CONFIGURED
MAIL_UNAUTHORIZED
MAIL_IDENTITY_NOT_FOUND
MAIL_IDENTITY_UNAUTHORIZED
MAIL_DOMAIN_UNVERIFIED
MAIL_TEMPLATE_NOT_FOUND
MAIL_INVALID_RECIPIENT
MAIL_MESSAGE_TOO_LARGE
MAIL_RATE_LIMITED
MAIL_SUPPRESSED
MAIL_DELIVERY_FAILED
MAIL_TEST_TRANSPORT_DISABLED

Applications should never need to parse SMTP error strings.

⸻

47. Transactional Semantics

Mail sending must be treated as an asynchronous side effect.

The API should return:

{
  "message_id": "...",
  "status": "queued"
}

It should not pretend that:

queued == delivered

Delivery status must remain observable.

⸻

48. Correlation

Messages should accept:

correlation_id
causation_id
request_id

Example:

await mail.send("reset", {
  ...,
  metadata: {
    correlationId: authRequest.id,
    causationId: passwordReset.id
  }
})

This allows AuthBoundry to correlate:

signup
→ token creation
→ email
→ click
→ verification

⸻

49. AuthBoundry Required Templates

MailPort must be capable of supporting at least:

verify-email
password-reset
magic-link
invitation
email-change
email-change-confirmation
mfa-enrollment
mfa-recovery
account-recovery
login-notification
password-changed
account-created
account-disabled

MailPort does not own AuthBoundry business logic.

AuthBoundry owns the events and templates.

MailPort owns delivery.

⸻

50. AuthBoundry Example

AuthBoundry declares:

use mail
mail {
  identities {
    auth = "auth@authboundry.com"
  }
  templates {
    verify-email = "./emails/verify-email.html"
    password-reset = "./emails/password-reset.html"
    magic-link = "./emails/magic-link.html"
  }
}

Then:

await mail.send("password-reset", {
  identity: "auth",
  to: user.email,
  variables: {
    name: user.name,
    reset_url: resetUrl
  },
  idempotencyKey: `password-reset:${reset.id}`
})

MailPort knows nothing about passwords or authentication.

⸻

51. Test Isolation

Tests must be able to isolate mail by:

test_run_id
application_id
tenant_id

Example:

await mail.test.waitFor({
  testRunId,
  to: user.email,
  template: "password-reset"
})

This prevents parallel AuthBoundry tests from accidentally consuming each other’s messages.

⸻

52. Test Scenario

A complete AuthBoundry test should be possible:

const user = await signup(...)
const verification = await mail.test.waitFor({
  to: user.email,
  template: "verify-email"
})
await browser.open(verification.links[0])
const reset = await requestPasswordReset(user.email)
const resetEmail = await mail.test.waitFor({
  to: user.email,
  template: "password-reset"
})
await browser.open(resetEmail.links[0])

No real mailbox is involved.

⸻

53. MailPort Deployment

Deploy MailPort independently.

Example:

Fly.io
└── mailport
    ├── API
    ├── workers
    ├── durable storage
    └── outbound MTA

Applications connect through:

MAILPORT_URL

⸻

54. Scaling

Initial deployment may be:

1 API
1 worker
1 storage

The architecture must allow:

N API instances
N workers

without duplicate delivery.

Workers require durable claiming/lease semantics.

⸻

55. Worker Semantics

Workers must safely handle:

claim
deliver
acknowledge
retry
failure
crash
restart

A worker crash must not permanently lose a queued message.

Duplicate delivery must be treated as possible at the infrastructure boundary.

⸻

56. Storage

MailPort must define a storage interface.

Do not hardcode FeltDB as the only supported database.

Conceptual interfaces:

MailStore
MessageStore
TemplateStore
IdentityStore
SuppressionStore
DeliveryStore

A FeltDB implementation may be the preferred implementation.

Other implementations must remain possible.

⸻

57. FeltDB Integration

If FeltDB is used, it should be an implementation detail:

MailPort
   ↓
MailStore
   ↓
FeltDB

Not:

Application
   ↓
FeltDB
   ↓
SMTP

This keeps MailPort independently deployable.

⸻

58. Configuration Example

Complete application:

use mail
mail {
  identities {
    system = "notifications@myapp.com"
    auth = "auth@myapp.com"
    billing = "billing@myapp.com"
  }
  templates {
    welcome = "./emails/welcome.html"
    verify = "./emails/verify.html"
    reset = "./emails/reset.html"
    invitation = "./emails/invitation.html"
    invoice = "./emails/invoice.html"
  }
}

No SMTP configuration appears here.

⸻

59. Generated Contract

The DSL compiler should produce an authoritative capability declaration equivalent to:

{
  "capability": "mail",
  "identities": [
    "system",
    "auth",
    "billing"
  ],
  "templates": [
    "welcome",
    "verify",
    "reset",
    "invitation",
    "invoice"
  ]
}

This becomes part of the application’s contract snapshot.

⸻

60. Studio

Studio should eventually expose:

Mail
 ├── Connection
 ├── Domains
 ├── Identities
 ├── Templates
 ├── Delivery
 ├── Test Inbox
 └── Logs

The Studio test inbox is especially valuable for AuthBoundry development.

Studio should display:

VERIFY EMAIL
PASSWORD RESET
INVITATION
MAGIC LINK

and allow opening the actual generated message.

⸻

61. Security Boundary

The following are infrastructure secrets:

SMTP credentials
DKIM private keys
MailPort service credentials
domain signing credentials

They must never enter:

.flow
application source
Contract Snapshot
CLI-generated application files
Git

⸻

62. DKIM / SPF / DMARC

Production MailPort must support proper domain authentication.

The service should expose domain setup information through:

app mail domains

Example:

Domain: authboundry.com
SPF       ✓
DKIM      ✓
DMARC     ✓
Status    VERIFIED

⸻

63. Initial Production Safety

The first production implementation must default to conservative behavior.

Before a domain becomes send-enabled:

domain verified
identity verified
authorization configured

No arbitrary sender addresses.

⸻

64. Provider Independence

MailPort must have an internal delivery interface.

Conceptually:

interface MailTransport {
  send(message: OutboundMessage): Promise<DeliveryResult>
}

Initial implementation:

SmtpTransport
MemoryTransport
LocalTransport

Future implementations may include:

another SMTP MTA
local MTA
provider relay

The MailPort contract does not change.

⸻

65. Critical Non-Goals

MailPort 1.0 does NOT implement:

* IMAP
* POP3
* human inboxes
* webmail
* contact management
* marketing campaigns
* mailing lists
* newsletter subscription management
* email analytics as a marketing platform
* CRM functionality

This is transactional infrastructure.

⸻

66. Repository Structure

Recommended:

mailport/
  apps/
    server/
    worker/
    studio/
  packages/
    core/
    sdk/
    dsl/
    transports/
      memory/
      local/
      smtp/
  docs/
    specification/
    architecture/
    operations/
    security/
  examples/
    basic/
    authboundry/
  tests/
    integration/
    delivery/
    authboundry/

⸻

67. Implementation Phases

PR1 — Mail capability DSL

Implement:

use mail
mail {
  identities {...}
  templates {...}
}

Add:

* parser
* validation
* contract snapshot
* generated API surface
* configuration resolution

No real delivery required.

⸻

PR2 — Local MailPort

Implement:

app mail dev

with:

* local server
* memory transport
* test inbox
* message API
* template rendering

This PR must demonstrate:

application
→ mail.send()
→ MailPort
→ test inbox

⸻

PR3 — AuthBoundry integration

Wire AuthBoundry to MailPort.

Demonstrate:

signup
→ verification email
→ verification link
→ verified account
password reset
→ reset email
→ reset link
→ password changed

All using the local test inbox.

⸻

PR4 — Durable MailPort

Implement:

* persistent outbox
* worker
* retries
* idempotency
* leases
* message lifecycle
* audit records

⸻

PR5 — Production SMTP

Implement:

* SMTP transport
* TLS
* authentication
* domain identities
* production configuration
* Fly deployment

⸻

PR6 — Production Operations

Implement:

* domain management
* DKIM
* SPF/DMARC status
* suppression
* bounce architecture
* metrics
* delivery logs
* rate limiting

⸻

PR7 — Studio

Add:

Mail
 ├── Inbox
 ├── Messages
 ├── Templates
 ├── Identities
 ├── Domains
 └── Delivery Health

⸻

68. Acceptance Test

A clean installation must support:

app init

Then:

use mail
mail {
  identities {
    system = "notifications@example.test"
  }
}

Application code:

await mail.send({
  identity: "system",
  to: "test@example.com",
  subject: "Hello",
  text: "MailPort works."
})

Run:

app mail dev

The message must appear in:

http://127.0.0.1:8788/mail

Then:

app mail test clear

must remove the test messages.

⸻

69. AuthBoundry Acceptance Test

The definitive integration proof is:

AuthBoundry
    ↓
signup
    ↓
MailPort
    ↓
test inbox
    ↓
verification link
    ↓
AuthBoundry
    ↓
verified
    ↓
password reset
    ↓
MailPort
    ↓
test inbox
    ↓
reset link
    ↓
new password
    ↓
login

The entire flow must run without:

* Gmail
* Outlook
* Resend
* SendGrid
* Postmark
* Mailgun
* external mailbox
* manual email copying

⸻

70. Definition of Done

MailPort is considered implemented when:

* use mail parses successfully
* Mail configuration is part of the authoritative contract
* applications can declare identities
* applications can declare templates
* SDK exposes mail.send()
* local MailPort exists
* local test inbox exists
* test messages never leave the machine
* AuthBoundry verification works through MailPort
* AuthBoundry password reset works through MailPort
* test code can retrieve verification/reset links
* idempotency prevents duplicate logical sends
* production messages use a durable outbox
* worker retries transient failures
* production SMTP credentials remain outside applications
* sender identities are authorized
* no open relay exists
* delivery status is observable
* audit records exist
* domain authentication is supported
* MailPort can be deployed independently on Fly.io
* FeltDB is optional behind the storage abstraction
* application source contains no provider SDK dependency
* switching the underlying transport does not require application changes

⸻

71. Core Thesis

The resulting developer experience should be:

use auth
use mail

rather than:

install auth SDK
install email provider SDK
create provider account
create API key
put API key in .env
configure SMTP/provider
write email integration

The application declares capabilities.

The infrastructure supplies their materialization.

For AuthBoundry in particular, email becomes a native part of the development and testing substrate rather than another external SaaS dependency.

MailPort is the capability. SMTP is merely one transport.

The piece I would implement first is PR1 + PR2 together enough to get the complete local loop working. That gives you an immediate superpower for AuthBoundry: every verification/reset/magic-link email becomes inspectable and machine-readable locally, so your integration tests can actually click the links instead of mocking the email system.
