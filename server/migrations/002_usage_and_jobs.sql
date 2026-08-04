CREATE TABLE usage_counters (
  scope TEXT NOT NULL CHECK (scope IN ('user', 'global')),
  owner_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (length(day) = 10),
  kind TEXT NOT NULL,
  used_units INTEGER NOT NULL CHECK (used_units >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  PRIMARY KEY (scope, owner_id, day, kind),
  CHECK ((scope = 'global' AND owner_id = '') OR (scope = 'user' AND owner_id <> ''))
) STRICT;

CREATE INDEX usage_counters_day_idx ON usage_counters(day, kind);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  aggregate_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at_ms INTEGER NOT NULL CHECK (available_at_ms >= 0),
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX jobs_claim_idx ON jobs(state, available_at_ms, lease_expires_at_ms);
CREATE INDEX jobs_owner_idx ON jobs(owner_id, type, updated_at_ms);
