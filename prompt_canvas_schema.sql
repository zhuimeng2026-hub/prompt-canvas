-- Prompt Canvas persistent schema (SQLite)
-- All timestamps are ISO-8601 UTC strings; ts columns for events are unix seconds.

CREATE TABLE IF NOT EXISTS canvases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  summary     TEXT,
  source      TEXT,                 -- e.g. "codex-thread-abc123" or "imported-from-json"
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id            TEXT PRIMARY KEY,    -- logical id, e.g. "ai_3bd76f3d"
  canvas_id     TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,      -- e.g. "v1", "v2"
  label         TEXT,
  x             REAL NOT NULL DEFAULT 0,
  y             REAL NOT NULL DEFAULT 0,
  w             REAL NOT NULL DEFAULT 300,
  h             REAL NOT NULL DEFAULT 400,
  image_url     TEXT,               -- /generated/<canvas_id>/<filename>
  natural_w     INTEGER,            -- source PNG pixel width
  natural_h     INTEGER,            -- source PNG pixel height
  aspect_ratio  REAL,               -- natural_w / natural_h
  prompt        TEXT,
  edit_of       TEXT,               -- parent image id
  model         TEXT,
  provider      TEXT,
  source_id     TEXT,
  image_meta    TEXT,               -- JSON blob (flexible)
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_canvas ON images(canvas_id);

CREATE TABLE IF NOT EXISTS annotations (
  id              TEXT PRIMARY KEY,  -- tldraw shape id, e.g. "shape:abc"
  canvas_id       TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  target_image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  kind            TEXT,             -- draw | arrow | text | geo
  x               REAL,
  y               REAL,
  w               REAL,
  h               REAL,
  text            TEXT,
  color           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_target ON annotations(target_image_id);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id TEXT REFERENCES canvases(id) ON DELETE CASCADE,
  action    TEXT NOT NULL,
  args_json TEXT,
  ts        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_canvas_ts ON events(canvas_id, ts);
