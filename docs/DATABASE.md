# Database foundation

`db/migrations/001_initial.sql` targets MySQL 8.0.16+ or MariaDB 10.6+ with InnoDB and enforced CHECK constraints. It has **not been run against a database in this environment** and remains a draft. Use only a dedicated disposable test database after review. No production data should be placed in it yet.

## Migration runner

Install Node.js 20+ dependencies with `npm ci`. Create an empty database and a dedicated migration user with the necessary DDL privileges; supply configuration in the environment, never commit credentials:

```sh
export DB_HOST='database-host' DB_PORT='3306' DB_NAME='pall_test_example' DB_USER='migration_user'
# Set DB_PASSWORD securely in your shell or secret manager.
export DB_TLS=true # when the server supports TLS and its certificate is trusted
npm run migrate
```

`DB_TLS=true` enables certificate verification; absent or any other value means no TLS. Use TLS for remote production database connections. The migration runner uses a database-specific advisory lock, sets its session time zone to UTC, stores SHA-256 checksums, refuses modified/missing/out-of-order migrations, and records a dirty state before executing each file. DDL auto-commits: an error can leave a partial schema. The dirty marker prevents automatic replay. Inspect the schema and restore from a verified backup or write a reviewed forward repair; only clear the marker after a human has reconciled the actual schema and migration history. Never blindly rerun or drop financial history. A migration account should be separate from the application's limited-privilege runtime account. Do not edit applied migration files.

## Tests

`npm test` runs unit tests with a fake connection. The database integration test is skipped by default. To opt in, configure the variables above with a **dedicated** database whose name begins `pall_test_`, then run:

```sh
PALL_DB_INTEGRATION=1 npm test
```

The tests apply migrations (persistent schema changes). One test rolls back its fixtures; the account and concurrent-ledger test commits a uniquely named test account and deletes its own fixtures afterward. Neither test drops a database. Do not point it at an existing database containing user data. Neither the migration nor the integration test has yet been verified against a live database here.

## Design and limitations

Tables use foreign keys and indexes for wallet/order history; monetary fields use signed BIGINT minor units. The order's provider idempotency key is globally unique within a provider, and each wallet operation has a unique key. An internal, unexposed wallet ledger primitive now uses a row lock, idempotency check, and atomic wallet/ledger transaction; it has only mock tests in this environment. Schema constraints alone cannot guarantee the ledger chain or avoid lost updates. The primitive is not a complete wallet, payment or reconciliation system. Restrict UPDATE/DELETE privileges on audit and ledger tables. Initial permissions are deliberately empty, so no role grants access by default.

Before production: integration-test schema and migrations on the selected engine and versions; document and test backup, restore, retention and forward repair; add tables required by remaining features; define currency metadata and database access separation. No backup, rollback or retention automation exists yet.

## Disposable local MariaDB with Docker Compose

`compose.yaml` runs MariaDB 11.4 bound only to the local host. Install Docker with the Compose plugin first. Copy `.env.example` to `.env` and replace both example passwords with distinct local-only values. Never commit the file. Then:

```sh
cp .env.example .env
# Edit .env and set local-only passwords before continuing.
set -a; . ./.env; set +a
docker compose up -d --wait
npm ci
npm run db:check
npm run migrate
npm run db:status
PALL_DB_INTEGRATION=1 npm test
```

Use only a disposable `pall_test_` database: these integration tests create schema and account/ledger fixtures. `docker compose down` stops the container but retains the named volume. Do not remove that volume if it contains data you need. Environment initialization variables apply only to a fresh MariaDB data volume; changing passwords in `.env` does not change an existing database user. The database check verifies connectivity, foreign-key checking and UTC session configuration; it does not prove migration completeness or production readiness. This Compose configuration and the integration suite have not been run here because Docker/MariaDB is unavailable.

Migration 005 adds four read-only admin permissions without assigning any to roles. Administrative views are inaccessible until a trusted operator grants a role the appropriate permission. The application does not yet offer administrative role management or a production bootstrap process.

Migration 006 adds separate suspend/restore permissions with no automatic grants. Status updates, session revocation, and audit entries use one database transaction, but this has not been exercised against MariaDB in this environment.

Migration 007 adds support permissions, idempotent staff-reply keys and in-app notifications. Grants remain empty by default. Staff replies, notification insertion and audit records share a transaction; the behavior has mock coverage but has not been exercised against MariaDB here.

Migration 008 adds support status events and a separate status-change permission without grants. Status, notification and audit changes are transactional in application code; MariaDB verification is still required.

Migrations 009 and 010 add API usage metadata, a per-key sampled rate-limit indicator, retention indexes and maintenance job records. The optional worker deletes bounded batches of API logs older than 30 days, sessions expired over 7 days ago, and completed maintenance records older than 90 days. It uses a database-specific advisory lock, but it has not been verified against MariaDB here. Never enable retention without reviewing data and backup requirements.
