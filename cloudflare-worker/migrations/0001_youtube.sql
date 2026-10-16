-- Additive tables only. Existing jobs and job_events are untouched.
CREATE TABLE IF NOT EXISTS mse_youtube_oauth_states (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mse_youtube_connection (
 channel_id TEXT PRIMARY KEY, encrypted_token TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mse_youtube_jobs (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', session_cipher TEXT,
 offset_bytes INTEGER NOT NULL DEFAULT 0, video_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
