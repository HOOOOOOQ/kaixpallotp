-- Customer support records. Staff-only fields are intentionally not exposed by customer APIs.
CREATE TABLE support_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(160) NOT NULL,
  category VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_tickets_user_id (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_FOR_CUSTOMER','RESOLVED','CLOSED')),
  CHECK (category IN ('ACCOUNT','ORDER','PAYMENT','TECHNICAL','OTHER'))
) ENGINE=InnoDB;
CREATE TABLE support_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_messages_ticket_id (ticket_id, id),
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB;
