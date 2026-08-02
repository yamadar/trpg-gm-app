CREATE TABLE storage_accounts (
  owner_id TEXT PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  limit_bytes INTEGER NOT NULL DEFAULT 0 CHECK (limit_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE storage_items (
  item_type TEXT NOT NULL CHECK (item_type IN ('record', 'document', 'media')),
  resource_key TEXT NOT NULL,
  owner_id TEXT,
  charged_bytes INTEGER NOT NULL CHECK (charged_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  PRIMARY KEY (item_type, resource_key)
) STRICT;

CREATE INDEX storage_items_owner_idx ON storage_items(owner_id, item_type);

CREATE TABLE storage_reservations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0),
  purpose TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
) STRICT;

CREATE INDEX storage_reservations_expiry_idx ON storage_reservations(expires_at_ms);
CREATE INDEX storage_reservations_owner_idx ON storage_reservations(owner_id);

CREATE TRIGGER storage_items_account_insert
AFTER INSERT ON storage_items
WHEN NEW.owner_id IS NOT NULL
BEGIN
  INSERT INTO storage_accounts(owner_id, used_bytes, reserved_bytes, limit_bytes, updated_at_ms)
  VALUES (NEW.owner_id, NEW.charged_bytes, 0, 0, NEW.updated_at_ms)
  ON CONFLICT(owner_id) DO UPDATE SET
    used_bytes = used_bytes + NEW.charged_bytes,
    updated_at_ms = NEW.updated_at_ms;
END;

CREATE TRIGGER storage_items_account_update_old
AFTER UPDATE OF owner_id, charged_bytes ON storage_items
WHEN OLD.owner_id IS NOT NULL
BEGIN
  UPDATE storage_accounts
  SET used_bytes = MAX(0, used_bytes - OLD.charged_bytes),
      updated_at_ms = NEW.updated_at_ms
  WHERE owner_id = OLD.owner_id;
END;

CREATE TRIGGER storage_items_account_update_new
AFTER UPDATE OF owner_id, charged_bytes ON storage_items
WHEN NEW.owner_id IS NOT NULL
BEGIN
  INSERT INTO storage_accounts(owner_id, used_bytes, reserved_bytes, limit_bytes, updated_at_ms)
  VALUES (NEW.owner_id, NEW.charged_bytes, 0, 0, NEW.updated_at_ms)
  ON CONFLICT(owner_id) DO UPDATE SET
    used_bytes = used_bytes + NEW.charged_bytes,
    updated_at_ms = NEW.updated_at_ms;
END;

CREATE TRIGGER storage_items_account_delete
AFTER DELETE ON storage_items
WHEN OLD.owner_id IS NOT NULL
BEGIN
  UPDATE storage_accounts
  SET used_bytes = MAX(0, used_bytes - OLD.charged_bytes),
      updated_at_ms = OLD.updated_at_ms
  WHERE owner_id = OLD.owner_id;
END;

CREATE TRIGGER domain_records_storage_insert
AFTER INSERT ON domain_records
WHEN NEW.owner_id IS NOT NULL
BEGIN
  INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
  VALUES ('record', NEW.key, NEW.owner_id, NEW.logical_bytes, NEW.updated_at_ms)
  ON CONFLICT(item_type, resource_key) DO UPDATE SET
    owner_id = excluded.owner_id,
    charged_bytes = excluded.charged_bytes,
    updated_at_ms = excluded.updated_at_ms;
END;

CREATE TRIGGER domain_records_storage_update
AFTER UPDATE OF owner_id, logical_bytes ON domain_records
BEGIN
  DELETE FROM storage_items WHERE item_type = 'record' AND resource_key = NEW.key;
  INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
  SELECT 'record', NEW.key, NEW.owner_id, NEW.logical_bytes, NEW.updated_at_ms
  WHERE NEW.owner_id IS NOT NULL;
END;

CREATE TRIGGER domain_records_storage_delete
AFTER DELETE ON domain_records
BEGIN
  DELETE FROM storage_items WHERE item_type = 'record' AND resource_key = OLD.key;
END;

CREATE TRIGGER documents_storage_insert
AFTER INSERT ON documents
WHEN NEW.owner_id IS NOT NULL
BEGIN
  INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
  VALUES ('document', NEW.path, NEW.owner_id, NEW.logical_bytes, NEW.updated_at_ms)
  ON CONFLICT(item_type, resource_key) DO UPDATE SET
    owner_id = excluded.owner_id,
    charged_bytes = excluded.charged_bytes,
    updated_at_ms = excluded.updated_at_ms;
END;

CREATE TRIGGER documents_storage_update
AFTER UPDATE OF owner_id, logical_bytes ON documents
BEGIN
  DELETE FROM storage_items WHERE item_type = 'document' AND resource_key = NEW.path;
  INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
  SELECT 'document', NEW.path, NEW.owner_id, NEW.logical_bytes, NEW.updated_at_ms
  WHERE NEW.owner_id IS NOT NULL;
END;

CREATE TRIGGER documents_storage_delete
AFTER DELETE ON documents
BEGIN
  DELETE FROM storage_items WHERE item_type = 'document' AND resource_key = OLD.path;
END;

INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
SELECT 'record', key, owner_id, logical_bytes, updated_at_ms
FROM domain_records
WHERE owner_id IS NOT NULL;

INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
SELECT 'document', path, owner_id, logical_bytes, updated_at_ms
FROM documents
WHERE owner_id IS NOT NULL;
