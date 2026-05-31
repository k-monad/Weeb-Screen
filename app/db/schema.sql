-- Weeb-Screen ticket A schema.
-- Dialect: SQLite. All text is UTF-8. Runtime code enables FK + WAL.

CREATE TABLE IF NOT EXISTS shows (
  id                          INTEGER PRIMARY KEY,
  title                       TEXT    NOT NULL,
  slug                        TEXT    NOT NULL UNIQUE,
  service_name                TEXT,
  total_real_episodes         INTEGER,
  season_boundary_source_url  TEXT,
  notes                       TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id                          INTEGER PRIMARY KEY,
  show_id                     INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  real_episode_number         INTEGER NOT NULL,
  service_season_number       INTEGER NOT NULL,
  service_episode_number      INTEGER NOT NULL,
  service_episode_code        TEXT    NOT NULL,
  episode_title               TEXT    NOT NULL,
  filler_bucket               TEXT    NOT NULL
                                CHECK (filler_bucket IN ('No','Mixed','Yes')),
  canon_filler_type           TEXT    NOT NULL,
  original_airdate            TEXT,
  episode_data_source_url     TEXT,
  season_boundary_source_url  TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (show_id, real_episode_number),
  UNIQUE (show_id, service_season_number, service_episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_show_season
  ON episodes(show_id, service_season_number, service_episode_number);

CREATE INDEX IF NOT EXISTS idx_episodes_show_real
  ON episodes(show_id, real_episode_number);

CREATE INDEX IF NOT EXISTS idx_episodes_show_bucket
  ON episodes(show_id, filler_bucket);

CREATE TABLE IF NOT EXISTS profiles (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  is_household  INTEGER NOT NULL DEFAULT 0 CHECK (is_household IN (0, 1)),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  id          INTEGER PRIMARY KEY,
  profile_id  INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  watched     INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  watched_at  TEXT,
  updated_at  TEXT NOT NULL,
  UNIQUE (profile_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_profile_episode
  ON progress(profile_id, episode_id);

CREATE TABLE IF NOT EXISTS import_jobs (
  id             INTEGER PRIMARY KEY,
  show_id        INTEGER REFERENCES shows(id) ON DELETE SET NULL,
  filename       TEXT,
  format         TEXT CHECK (format IN ('xlsx','csv')),
  show_slug      TEXT,
  status         TEXT NOT NULL
                   CHECK (status IN ('preview','committed','failed')),
  rows_total     INTEGER,
  rows_imported  INTEGER,
  rows_updated   INTEGER,
  rows_skipped   INTEGER,
  counts_json    TEXT,
  preview_json   TEXT,
  error_text     TEXT,
  created_at     TEXT NOT NULL,
  finished_at    TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO profiles(id, name, is_household, created_at)
VALUES (1, 'Household', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO NOTHING;

INSERT INTO app_settings(key, value)
VALUES
  ('skip_filler_default', 'false'),
  ('progress_view_default', 'canon'),
  ('season_details_default', 'false')
ON CONFLICT(key) DO NOTHING;
