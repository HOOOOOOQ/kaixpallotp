ALTER TABLE api_keys ADD COLUMN limit_logged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE api_usage_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  api_key_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint VARCHAR(80) NOT NULL,
  status_code SMALLINT UNSIGNED NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  correlation_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_usage_user_id (user_id, id),
  KEY idx_usage_created (created_at, id),
  KEY idx_usage_key_created (api_key_id, created_at),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
