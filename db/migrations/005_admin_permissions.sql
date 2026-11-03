-- No automatic grants: an authorized operator must explicitly grant permissions.
INSERT INTO permissions (name) VALUES
  ('admin.overview.read'), ('admin.users.read'), ('admin.orders.read'), ('admin.audit.read');
