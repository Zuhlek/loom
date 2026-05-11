-- Nora metadata store schema.
-- PGlite-compatible (Postgres dialect).

CREATE TABLE IF NOT EXISTS Project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  paths_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS Chat (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  cwd TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'default',
  worktree_mode TEXT NOT NULL DEFAULT 'local',
  worktree_path TEXT,
  session_id TEXT,
  pid INTEGER,
  last_opened TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  resume_banner_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  inert BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS PendingGate (
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, kind)
);

CREATE TABLE IF NOT EXISTS HookRegistration (
  marker TEXT PRIMARY KEY,
  port INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'user',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
