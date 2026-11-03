# Architecture and execution plan

## Phase A: analysis

The starting repository contained only `OTP.zip` and a minimal README. The archive contains a reseller API guide, OpenAPI 3.0.3 contract, error catalog and sample clients. Preserve that archive as the source contract. There is no existing app or user database to migrate.

Proposed architecture: a TypeScript/Next.js frontend, one Node.js service responsible for business rules and versioned APIs, MySQL/MariaDB as the system of record, and a separate worker using the same domain modules. The browser never contacts Zyrex directly. Payment adapters and Zyrex access are server-side; no provider purchase or money movement is enabled until integration and reconciliation are tested. Production requires TLS termination, secret management, restricted database credentials, backups, monitoring and independent security review. This is a plan, not deployed infrastructure.

## Invariants for future implementation

- Authenticate and authorize on the server for every customer and admin action. Default-deny permissions; role records are not proof of authorization. No permissions have been seeded yet.
- Lock the wallet row and commit balance updates, unique operation keys, ledger entries and order events in one database transaction. Avoid network calls while holding database locks. Reconcile reservations and uncertain outcomes explicitly.
- Provider requests use a persisted, unique idempotency key and immutable request hash. A timeout or ambiguous provider response is not permission to purchase again. Use provider evidence to resolve UNKNOWN.
- All wallet amounts are integer minor units; currency and minor-unit precision must be defined and validated centrally. Zyrex prices are IDR. Never use floating-point arithmetic for money.
- Do not persist OTP contents by default; do not place secrets, authorization headers, OTPs or complete provider payloads in logs. Any future short-lived OTP storage needs encryption, access control, expiration and deletion.
- Append-only audit/ledger behavior must be enforced by database privileges and application design; the draft schema alone does not make records immutable.

## Planned phases

A analysis (this document); B schema foundation (draft only); C authentication and RBAC; D public design system; E dashboard; F Zyrex adapter; G orders; H transactional wallet; I admin; J developer API; K support/notifications; L monitoring/jobs; M hardening; N integration, security, deployment and end-to-end verification. Each phase must be independently tested; acceptance criteria in the project brief remain open.

## Order states

The transition table in `src/domain/order-state.mjs` is a conservative initial policy, not a provider status mapping. `UNKNOWN` represents uncertain outcomes; terminal states cannot transition. `OTP_RECEIVED` does not imply accounting settlement. Transitions require authorization, verified provider business status and atomic event recording; none of these are implemented yet. Provider-specific status mappings and corrections require documented evidence and reconciliation policy before deployment.
