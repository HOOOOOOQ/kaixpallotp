INSERT INTO permissions (name) VALUES ('admin.support.status');
CREATE TABLE support_status_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_support_status_ticket (ticket_id, id),
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
