CREATE TABLE domain_records (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL CHECK (module IN (
    'auth', 'library', 'sessions', 'campaigns', 'party',
    'publishing', 'usage', 'jobs', 'system'
  )),
  resource_type TEXT NOT NULL,
  owner_id TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX domain_records_module_owner_idx
  ON domain_records(module, owner_id);

CREATE INDEX domain_records_owner_key_idx
  ON domain_records(owner_id, key);

CREATE TABLE documents (
  path TEXT PRIMARY KEY,
  module TEXT NOT NULL CHECK (module IN (
    'library', 'sessions', 'campaigns', 'publishing', 'system'
  )),
  resource_type TEXT NOT NULL,
  owner_id TEXT,
  content TEXT NOT NULL,
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX documents_module_owner_idx
  ON documents(module, owner_id);

CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;
