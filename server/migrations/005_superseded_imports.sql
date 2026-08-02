CREATE TABLE migration_journal_next (
  source_path TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('record', 'document', 'media')),
  target_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('imported', 'adopted', 'retained', 'superseded')),
  imported_at_ms INTEGER NOT NULL CHECK (imported_at_ms >= 0)
) STRICT;

INSERT INTO migration_journal_next(
  source_path, source_sha256, source_bytes, target_kind, target_key, status, imported_at_ms
)
SELECT source_path, source_sha256, source_bytes, target_kind, target_key, status, imported_at_ms
FROM migration_journal;

DROP TABLE migration_journal;
ALTER TABLE migration_journal_next RENAME TO migration_journal;

CREATE INDEX migration_journal_target_idx
  ON migration_journal(target_kind, target_key);
