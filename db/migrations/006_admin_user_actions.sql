-- Explicit grants only; no role receives privileged actions automatically.
INSERT INTO permissions (name) VALUES ('admin.users.suspend'), ('admin.users.restore');
