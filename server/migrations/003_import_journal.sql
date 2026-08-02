CREATE TABLE migration_journal (
  source_path TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('record', 'document', 'media')),
  target_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('imported', 'adopted', 'retained')),
  imported_at_ms INTEGER NOT NULL CHECK (imported_at_ms >= 0)
) STRICT;

CREATE INDEX migration_journal_target_idx
  ON migration_journal(target_kind, target_key);

CREATE TABLE migration_quarantine (
  source_path TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0),
  reason TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  quarantined_at_ms INTEGER NOT NULL CHECK (quarantined_at_ms >= 0)
) STRICT;
