CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  resource_key TEXT NOT NULL,
  owner_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'deleting', 'deleted', 'failed')),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX media_assets_state_idx ON media_assets(state, updated_at_ms);
CREATE INDEX media_assets_owner_idx ON media_assets(owner_id, state, updated_at_ms);
CREATE INDEX media_assets_resource_idx ON media_assets(resource_key, state);

CREATE TABLE media_bindings (
  resource_key TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE RESTRICT,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TRIGGER media_bindings_ready_insert
BEFORE INSERT ON media_bindings
WHEN (SELECT state FROM media_assets WHERE id = NEW.asset_id) <> 'ready'
BEGIN
  SELECT RAISE(ABORT, 'media binding requires ready asset');
END;

CREATE TRIGGER media_bindings_ready_update
BEFORE UPDATE OF asset_id ON media_bindings
WHEN (SELECT state FROM media_assets WHERE id = NEW.asset_id) <> 'ready'
BEGIN
  SELECT RAISE(ABORT, 'media binding requires ready asset');
END;

CREATE TRIGGER media_bindings_storage_insert
AFTER INSERT ON media_bindings
BEGIN
  INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
  SELECT 'media', NEW.resource_key, owner_id, byte_size, NEW.updated_at_ms
  FROM media_assets WHERE id = NEW.asset_id
  ON CONFLICT(item_type, resource_key) DO UPDATE SET
    owner_id = excluded.owner_id,
    charged_bytes = excluded.charged_bytes,
    updated_at_ms = excluded.updated_at_ms;
END;

CREATE TRIGGER media_bindings_storage_update
AFTER UPDATE OF asset_id, resource_key ON media_bindings
BEGIN
  DELETE FROM storage_items
  WHERE item_type = 'media' AND resource_key = OLD.resource_key;
  INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
  SELECT 'media', NEW.resource_key, owner_id, byte_size, NEW.updated_at_ms
  FROM media_assets WHERE id = NEW.asset_id
  ON CONFLICT(item_type, resource_key) DO UPDATE SET
    owner_id = excluded.owner_id,
    charged_bytes = excluded.charged_bytes,
    updated_at_ms = excluded.updated_at_ms;
END;

CREATE TRIGGER media_bindings_storage_delete
AFTER DELETE ON media_bindings
BEGIN
  DELETE FROM storage_items
  WHERE item_type = 'media' AND resource_key = OLD.resource_key;
END;

INSERT INTO media_assets(
  id, resource_key, owner_id, object_key, state, sha256, byte_size,
  mime_type, last_error_code, created_at_ms, updated_at_ms
)
SELECT
  'legacy:' || resource_key,
  resource_key,
  owner_id,
  resource_key,
  'ready',
  NULL,
  charged_bytes,
  'application/octet-stream',
  NULL,
  updated_at_ms,
  updated_at_ms
FROM storage_items
WHERE item_type = 'media';

INSERT INTO media_bindings(resource_key, asset_id, updated_at_ms)
SELECT resource_key, 'legacy:' || resource_key, updated_at_ms
FROM storage_items
WHERE item_type = 'media';

CREATE TABLE object_migration_journal (
  object_key TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0),
  target_driver TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'adopted', 'validated')),
  migrated_at_ms INTEGER NOT NULL CHECK (migrated_at_ms >= 0)
) STRICT;
