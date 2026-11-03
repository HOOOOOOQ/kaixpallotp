INSERT INTO permissions (name) VALUES ('admin.support.read'), ('admin.support.reply');
ALTER TABLE support_messages ADD COLUMN operation_key VARCHAR(64) NULL,
  ADD UNIQUE KEY uq_support_operation (ticket_id, operation_key);
CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(32) NOT NULL,
  title VARCHAR(160) NOT NULL,
  reference_type VARCHAR(32) NOT NULL,
  reference_id VARCHAR(128) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  read_at DATETIME(6) NULL,
  KEY idx_notifications_user (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
