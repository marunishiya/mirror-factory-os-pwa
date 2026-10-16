-- Disposable LOCAL D1 fixture only. NOT a production migration.
-- Deliberately mirrors the names/columns referenced by Worker v0.6.
-- Actual production D1 schema must be verified separately before deploy.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  asset_ref TEXT NOT NULL DEFAULT '',
  run_at_utc TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run','live')),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, platform)
);
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  event TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (mode,status,run_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events (job_id,created_at);

-- PROJECT MIRROR additive schema proposal, NOT applied to production.
-- Video-only tables isolate official media receipts from legacy DRY-RUN jobs.
-- Review against production schema before any D1 --remote migration.
CREATE TABLE IF NOT EXISTS video_jobs (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN('youtube','instagram','tiktok')),
 title TEXT NOT NULL,
 caption TEXT NOT NULL,
 asset_ref TEXT NOT NULL DEFAULT '',
 video_url TEXT NOT NULL DEFAULT '',
 privacy_level TEXT NOT NULL DEFAULT '',
 ai_generated INTEGER NOT NULL CHECK(ai_generated IN(0,1)),
 run_at_utc TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 phase TEXT NOT NULL DEFAULT 'waiting_schedule',
 provider_id TEXT NOT NULL DEFAULT '',
 published_id TEXT NOT NULL DEFAULT '',
 attempts INTEGER NOT NULL DEFAULT 0,
 check_attempts INTEGER NOT NULL DEFAULT 0,
 next_check_utc TEXT NOT NULL DEFAULT '',
 last_error TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(campaign_id,platform)
);
CREATE TABLE IF NOT EXISTS video_job_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL REFERENCES video_jobs(id),
 event TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mirror_video_due ON video_jobs(status,run_at_utc);
CREATE INDEX IF NOT EXISTS idx_mirror_video_check ON video_jobs(status,next_check_utc);
CREATE INDEX IF NOT EXISTS idx_mirror_video_events ON video_job_events(job_id,id);
