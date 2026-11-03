# PALL × KAII

Powering Digital Connections.

This repository currently contains **an early foundation, not a running marketplace**. The original `OTP.zip` is preserved; it includes the Zyrex reseller documentation, OpenAPI contract, examples and clients. No credentials are included or required to run the domain tests.

## Current scope

- Initial MySQL/MariaDB schema draft and checksum/lock-based migration runner: roles, permissions, users, wallets, orders, order events, ledger and audit log.
- Public informational site and application/database health endpoint.
- Database-backed registration, login, logout, customer support tickets/replies, and a read-only dashboard with order and transaction history, filtering, pagination, and details (not yet integration-tested against a database).
- Administration views for overview, users, orders, audit logs and support, plus permission-controlled suspension/restoration and staff replies/private notes (mock-tested only).
- Persistent in-app support-reply notifications with owner-scoped read controls (mock-tested only).
- Read-only developer API reference, key rotation, and account-scoped usage reports (mock-tested only).
- Opt-in bounded retention worker for API usage and expired sessions (mock-tested only).
- Server-only, read-only Zyrex client (not exposed by the web server).
- Order-transition and wallet-ledger transaction primitives with mock tests. These are internal and do not enable purchases or payments.
- Architecture and provider-contract notes in `docs/`.

The public site and a read-only Zyrex adapter are early implementations. Account and dashboard functionality is implemented but has not yet been verified with MySQL/MariaDB. There is no email verification, password recovery, 2FA, payment integration, provider/order worker, order placement, support attachments, admin financial actions or live provider integration yet. Support lists are limited to the most recent 50 tickets and 100 messages. The schema has not been exercised against a database. Do not deploy it or use it to hold real funds.

## Test

Node.js 20 or later:

```sh
npm test
```

Install dependencies first with `npm ci`. Database integration tests are opt-in and require a dedicated database; see the database guide. See [architecture](docs/ARCHITECTURE.md), [database](docs/DATABASE.md), and [provider notes](docs/API_INTEGRATION.md) for design decisions, limitations, and next steps.

## Run the public site

```sh
npm ci
npm start
```

Open `http://localhost:3000`. Set `PORT` to change the port. The health endpoint reports the database as not configured unless `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` are set; `DB_TLS=true` enables certificate verification. The provider is not checked. Registration and login require the database to be configured and migrations applied (`npm run migrate`). Purchases are not available. Set `APP_ORIGIN` to the exact public HTTPS origin and `NODE_ENV=production` for secure cookies. Never use this unfinished system for real accounts or funds.

## Security limitations

This is not production-ready. Email verification, password reset, two-factor authentication, distributed rate limiting, complete audit coverage and permission enforcement are not implemented. Login throttling is in-memory and per process, not suitable for a multi-instance deployment or shared reverse proxy. CSRF tokens rotate when the dashboard loads, so multiple tabs may need a refresh before logout. Database migrations and account workflows still require real database integration and independent security testing.

## Read-only customer API (early implementation)

After applying migrations and signing in, use the dashboard to create, rotate or revoke scoped API keys. The secret is displayed once and only its SHA-256 hash is stored. The currently implemented routes are `GET /api/v1/account`, `/api/v1/balance`, and `/api/v1/transactions`, with scopes `account.read`, `balance.read`, and `transactions.read` respectively. Transactions are limited to the latest 50. Values ending in `_minor` are strings containing integer minor units.

```sh
# Supply YOUR_API_KEY from a secure local source. Do not put it in source control.
curl -H "Authorization: Bearer $YOUR_API_KEY" https://YOUR_HOST/api/v1/balance
```

Authenticated requests are limited to 60 per key per minute using a database row lock; failed scope checks count toward the limit. This does not protect against unauthenticated request floods; add edge-level rate limiting and HTTPS before exposing the service. API key changes are audit-recorded. Key expiry, request-log pagination, webhooks and write operations are not implemented. Authenticated API logs record endpoint, status and latency without request bodies or secrets; 429 events are sampled once per key per window. A lost response during key rotation may leave the new secret unavailable, in which case create another key. This feature has mock tests but has not been tested against a live MySQL/MariaDB database or independently security-reviewed. The application remains unsuitable for production or real funds.

The opt-in database integration suite now includes concurrent ledger operations and API-key persistence/revocation. It has not been run in this workspace because no MySQL/MariaDB server or credentials were available. See `docs/DATABASE.md` for the dedicated-test-database setup and cleanup behavior.

## Administration (experimental)

The `/admin` control center contains overview, users, orders and audit views, and permission-controlled account suspension/restoration. The backend checks `admin.overview.read`, `admin.users.read`, `admin.orders.read` or `admin.audit.read` against the signed-in user's current database role on each request. Suspension/restoration additionally requires `admin.users.suspend` or `admin.users.restore`; sessions are revoked when an account is suspended. Migrations `005_admin_permissions.sql`, `006_admin_user_actions.sql`, and `007_support_notifications.sql` create permissions but grant none automatically. Support views and replies require `admin.support.read` and `admin.support.reply`, respectively; status changes require `admin.support.status` from migration 008. An authorized operator must provision roles and grants out of band; there is no role-management UI or safe production bootstrap flow yet. Read access is audit logged. These views and grants have not been verified on MariaDB and must not be exposed to production customers.

`npm run db:status` verifies local migration checksums and lists applied and pending files when a database is configured; it fails if the migration table is absent, dirty, or inconsistent.

## Application container

A Node.js application `Dockerfile` is included. It has not been built in this environment because Docker is unavailable. The existing `compose.yaml` is only for a disposable local MariaDB test instance, not a production stack. Supply `NODE_ENV=production`, `APP_ORIGIN`, database configuration and a TLS-terminating reverse proxy securely. The container health check is application liveness only; database and provider state are reported separately by `/api/health`. This project is not ready for production.

## Maintenance worker (opt-in)

After applying migrations, `ENABLE_MAINTENANCE_WORKER=true npm run worker` runs one bounded cleanup batch at startup and hourly. It uses a database advisory lock and records committed runs in `background_jobs`. It deletes up to 500 API usage logs older than 30 days, 500 sessions expired more than 7 days ago, and 500 completed maintenance records older than 90 days per batch. This is destructive retention processing: use a dedicated database account with only the required privileges and review the policy and backups before enabling. It does not process provider orders, payments, notifications or other business jobs. Worker behavior and migrations have not been verified against MariaDB.

## Vercel preview

The repository includes a static frontend and an HTTPS backend proxy configuration for Vercel. Vercel does **not** run the standalone server as a persistent process. Without a separately hosted backend and test database, API routes return 503; the site is not production-ready. Configuration has not yet been verified on Vercel. See [step-by-step setup and limitations](docs/VERCEL.md).

An operator-only Zyrex catalogue test endpoint can run on Vercel using server-side credentials without a separate backend; it does not provide customer login, purchases, or payments. See [Vercel setup](docs/VERCEL.md#uji-koneksi-zyrex-hanya-operator-read-only). Live provider connectivity is unverified.
