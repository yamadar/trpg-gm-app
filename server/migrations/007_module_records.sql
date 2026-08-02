CREATE TABLE auth_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE library_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE session_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE campaign_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE party_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE publishing_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE usage_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE job_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE system_records (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  parent_id TEXT, owner_id TEXT, title TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX auth_records_owner_type_idx ON auth_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX library_records_owner_type_idx ON library_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX library_records_parent_idx ON library_records(parent_id, entity_type);
CREATE INDEX session_records_owner_type_idx ON session_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX session_records_parent_idx ON session_records(parent_id, entity_type);
CREATE INDEX campaign_records_owner_type_idx ON campaign_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX campaign_records_parent_idx ON campaign_records(parent_id, entity_type);
CREATE INDEX party_records_owner_type_idx ON party_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX party_records_parent_idx ON party_records(parent_id, entity_type);
CREATE INDEX publishing_records_owner_type_idx ON publishing_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX publishing_records_parent_idx ON publishing_records(parent_id, entity_type);
CREATE INDEX usage_records_owner_type_idx ON usage_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX job_records_owner_type_idx ON job_records(owner_id, entity_type, updated_at_ms);
CREATE INDEX system_records_type_idx ON system_records(entity_type, updated_at_ms);

CREATE VIEW normalized_record_backfill AS
SELECT
  key, module, resource_type AS entity_type,
  COALESCE(
    CAST(json_extract(value_json, '$.id') AS TEXT),
    CAST(json_extract(value_json, '$.sessionId') AS TEXT),
    CAST(json_extract(value_json, '$.userId') AS TEXT),
    key
  ) AS entity_id,
  COALESCE(
    CAST(json_extract(value_json, '$.worldId') AS TEXT),
    CAST(json_extract(value_json, '$.campaignId') AS TEXT),
    CAST(json_extract(value_json, '$.sessionId') AS TEXT)
  ) AS parent_id,
  owner_id,
  COALESCE(
    CAST(json_extract(value_json, '$.title') AS TEXT),
    CAST(json_extract(value_json, '$.displayName') AS TEXT),
    CAST(json_extract(value_json, '$.name') AS TEXT),
    CAST(json_extract(value_json, '$.endingTitle') AS TEXT)
  ) AS title,
  value_json, logical_bytes, revision,
  COALESCE(CAST(json_extract(value_json, '$.createdAt') AS INTEGER), updated_at_ms) AS created_at_ms,
  updated_at_ms
FROM domain_records;

INSERT INTO auth_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'auth';
INSERT INTO library_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'library';
INSERT INTO session_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'sessions';
INSERT INTO campaign_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'campaigns';
INSERT INTO party_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'party';
INSERT INTO publishing_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'publishing';
INSERT INTO usage_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'usage';
INSERT INTO job_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'jobs';
INSERT INTO system_records SELECT key, entity_type, entity_id, parent_id, owner_id, title, value_json, logical_bytes, revision, created_at_ms, updated_at_ms FROM normalized_record_backfill WHERE module = 'system';

DROP VIEW normalized_record_backfill;

CREATE TABLE library_documents (
  path TEXT PRIMARY KEY, document_type TEXT NOT NULL, owner_id TEXT,
  title TEXT, content TEXT NOT NULL,
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE session_documents (
  path TEXT PRIMARY KEY, document_type TEXT NOT NULL, owner_id TEXT,
  title TEXT, content TEXT NOT NULL,
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE campaign_documents (
  path TEXT PRIMARY KEY, document_type TEXT NOT NULL, owner_id TEXT,
  title TEXT, content TEXT NOT NULL,
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE publishing_documents (
  path TEXT PRIMARY KEY, document_type TEXT NOT NULL, owner_id TEXT,
  title TEXT, content TEXT NOT NULL,
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE system_documents (
  path TEXT PRIMARY KEY, document_type TEXT NOT NULL, owner_id TEXT,
  title TEXT, content TEXT NOT NULL,
  logical_bytes INTEGER NOT NULL CHECK (logical_bytes >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX library_documents_owner_type_idx ON library_documents(owner_id, document_type, updated_at_ms);
CREATE INDEX session_documents_owner_type_idx ON session_documents(owner_id, document_type, updated_at_ms);
CREATE INDEX campaign_documents_owner_type_idx ON campaign_documents(owner_id, document_type, updated_at_ms);
CREATE INDEX publishing_documents_owner_type_idx ON publishing_documents(owner_id, document_type, updated_at_ms);
CREATE INDEX system_documents_type_idx ON system_documents(document_type, updated_at_ms);

INSERT INTO library_documents SELECT path, resource_type, owner_id, NULL, content, logical_bytes, updated_at_ms FROM documents WHERE module = 'library';
INSERT INTO session_documents SELECT path, resource_type, owner_id, NULL, content, logical_bytes, updated_at_ms FROM documents WHERE module = 'sessions';
INSERT INTO campaign_documents SELECT path, resource_type, owner_id, NULL, content, logical_bytes, updated_at_ms FROM documents WHERE module = 'campaigns';
INSERT INTO publishing_documents SELECT path, resource_type, owner_id, NULL, content, logical_bytes, updated_at_ms FROM documents WHERE module = 'publishing';
INSERT INTO system_documents SELECT path, resource_type, owner_id, NULL, content, logical_bytes, updated_at_ms FROM documents WHERE module = 'system';
