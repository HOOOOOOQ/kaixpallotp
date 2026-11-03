-- MySQL 8.0.16+ / MariaDB 10.6+. Run with session time_zone = '+00:00'.
-- Forward-only: back up before applying. Never drop financial history to roll back.
CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE
) ENGINE=InnoDB;
CREATE TABLE permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;
CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL, permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id), FOREIGN KEY (permission_id) REFERENCES permissions(id)
) ENGINE=InnoDB;
CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  email_verified_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (role_id) REFERENCES roles(id), CHECK (status IN ('ACTIVE','SUSPENDED','DELETION_REQUESTED'))
) ENGINE=InnoDB;
CREATE TABLE wallets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL, available_minor BIGINT NOT NULL DEFAULT 0, reserved_minor BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_wallet_user_currency (user_id, currency), FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (available_minor >= 0), CHECK (reserved_minor >= 0)
) ENGINE=InnoDB;
CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL, provider_order_id VARCHAR(128) NULL, reservation_ref VARCHAR(128) NULL,
  idempotency_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
  country_ref VARCHAR(128) NOT NULL, service_ref VARCHAR(128) NOT NULL,
  customer_price_minor BIGINT NOT NULL, provider_price_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  status VARCHAR(32) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), expires_at DATETIME(6) NULL,
  UNIQUE KEY uq_provider_idempotency (provider, idempotency_key), UNIQUE KEY uq_provider_order (provider, provider_order_id),
  KEY idx_orders_user_created (user_id, created_at, id), KEY idx_orders_status_updated (status, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id), CHECK (customer_price_minor >= 0), CHECK (provider_price_minor >= 0),
  CHECK (status IN ('CREATED','VALIDATING','PROCESSING','PENDING','OTP_RECEIVED','COMPLETED','FAILED','EXPIRED','CANCELLATION_REQUESTED','CANCELLED','UNKNOWN'))
) ENGINE=InnoDB;
CREATE TABLE order_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(32) NULL, to_status VARCHAR(32) NOT NULL, reason VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_order_events_order (order_id, id), FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
CREATE TABLE wallet_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, wallet_id BIGINT UNSIGNED NOT NULL,
  operation_key VARCHAR(128) NOT NULL, entry_type VARCHAR(32) NOT NULL,
  available_delta_minor BIGINT NOT NULL, reserved_delta_minor BIGINT NOT NULL,
  previous_available_minor BIGINT NOT NULL, new_available_minor BIGINT NOT NULL,
  previous_reserved_minor BIGINT NOT NULL, new_reserved_minor BIGINT NOT NULL,
  reference_type VARCHAR(32) NOT NULL, reference_id VARCHAR(128) NOT NULL,
  description VARCHAR(255) NOT NULL, created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_ledger_operation (wallet_id, operation_key), KEY idx_ledger_wallet_created (wallet_id, created_at, id),
  FOREIGN KEY (wallet_id) REFERENCES wallets(id), FOREIGN KEY (created_by) REFERENCES users(id),
  CHECK (new_available_minor >= 0), CHECK (new_reserved_minor >= 0),
  CHECK (new_available_minor = previous_available_minor + available_delta_minor),
  CHECK (new_reserved_minor = previous_reserved_minor + reserved_delta_minor)
) ENGINE=InnoDB;
CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL, target_type VARCHAR(64) NOT NULL, target_id VARCHAR(128) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_audit_target (target_type, target_id, id), FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
INSERT INTO roles (name) VALUES ('OWNER'),('SUPER_ADMIN'),('ADMINISTRATOR'),('SUPPORT'),('FINANCE'),('DEVELOPER'),('CUSTOMER');
