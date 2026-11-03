ALTER TABLE user_sessions ADD KEY idx_session_expiry (expires_at, id);
CREATE TABLE background_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_type VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  affected_rows INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at DATETIME(6) NULL,
  KEY idx_background_jobs_finished (status, finished_at, id),
  CHECK (status IN ('RUNNING','COMPLETED'))
) ENGINE=InnoDB;
