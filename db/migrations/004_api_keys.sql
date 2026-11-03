CREATE TABLE api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_prefix VARCHAR(16) NOT NULL,
  scope_account BOOLEAN NOT NULL DEFAULT FALSE,
  scope_balance BOOLEAN NOT NULL DEFAULT FALSE,
  scope_transactions BOOLEAN NOT NULL DEFAULT FALSE,
  window_started DATETIME(6) NULL,
  window_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_api_keys_user (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
