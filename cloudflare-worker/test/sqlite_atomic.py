"""SQLite-level transaction and compare-and-swap regression tests.
This validates SQL behavior, not a connection to production Cloudflare D1.
"""
import concurrent.futures
import sqlite3
import tempfile
from pathlib import Path

SCHEMA = """
CREATE TABLE jobs(
 id TEXT PRIMARY KEY, campaign_id TEXT, platform TEXT, title TEXT,
 caption TEXT, asset_ref TEXT, run_at_utc TEXT, mode TEXT,
 status TEXT, created_at TEXT, updated_at TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT DEFAULT '',
 UNIQUE(campaign_id,platform)
);
CREATE TABLE job_events(job_id TEXT, event TEXT, detail TEXT, created_at TEXT);
"""
NOW = "2026-10-16T10:00:00Z"
DUE = "2026-10-16T09:00:00Z"
UPDATE_DUE = """UPDATE jobs SET status='simulated',attempts=attempts+1,
 last_error='',updated_at=? WHERE id=? AND status='queued'
 AND mode='dry_run' AND run_at_utc<=?"""
INSERT_CLAIMED = """INSERT INTO job_events(job_id,event,detail,created_at)
 SELECT ?,?,?,? WHERE changes()=1"""
INSERT_SIMULATED = INSERT_CLAIMED


def connect(path):
    cx = sqlite3.connect(path, isolation_level=None, timeout=10)
    cx.execute("PRAGMA busy_timeout=10000")
    return cx


def txn(cx, sql_args):
    cx.execute("BEGIN IMMEDIATE")
    try:
        result = []
        for sql, params in sql_args:
            cx.execute(sql, params)
            result.append(cx.execute("SELECT changes()").fetchone()[0])
        cx.execute("COMMIT")
        return result
    except Exception:
        cx.execute("ROLLBACK")
        raise


def simulate(cx, job_id):
    return txn(cx, [
        (UPDATE_DUE, (NOW, job_id, NOW)),
        (INSERT_CLAIMED, (job_id, "claimed", "dry_run", NOW)),
        (INSERT_SIMULATED, (job_id, "simulated", "no_publish", NOW)),
    ])


with tempfile.TemporaryDirectory(prefix="mirror-sqlite-") as folder:
    db_path = Path(folder) / "test.sqlite"
    db = connect(db_path)
    db.executescript(SCHEMA)

    create_sql = """INSERT OR IGNORE INTO jobs
    (id,campaign_id,platform,title,caption,asset_ref,run_at_utc,mode,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'dry_run','queued',?,?)"""
    created_sql = """INSERT INTO job_events(job_id,event,detail,created_at)
    SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM jobs WHERE id=?)"""

    def create(job_id, campaign):
        return txn(db, [
            (create_sql, (job_id,campaign,"threads","Test","Text","",DUE,NOW,NOW)),
            (created_sql, (job_id,"created","dry_run",NOW,job_id)),
        ])

    assert create("one","campaign001") == [1,1]
    assert create("new-id","campaign001") == [0,0]
    assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM job_events WHERE event='created'").fetchone()[0] == 1
    print("PASS atomic job + creation event; duplicate has no event")

    cancel_sql = """UPDATE jobs SET status='cancelled',updated_at=?
      WHERE id=? AND status='queued'"""
    cancel_event_sql = """INSERT INTO job_events(job_id,event,detail,created_at)
      SELECT ?,?,?,? WHERE changes()=1"""

    def cancel(job_id):
        return txn(db,[
            (cancel_sql,(NOW,job_id)),
            (cancel_event_sql,(job_id,"cancelled","manual_cancel",NOW)),
        ])
    assert cancel("one") == [1,1]
    assert cancel("one") == [0,0]
    assert db.execute("SELECT COUNT(*) FROM job_events WHERE event='cancelled'").fetchone()[0] == 1
    print("PASS cancellation compare-and-swap and audit idempotency")

    assert create("sim1","campaign002") == [1,1]
    assert simulate(db,"sim1") == [1,1,1]
    assert simulate(db,"sim1") == [0,0,0]
    assert db.execute("SELECT status,attempts FROM jobs WHERE id='sim1'").fetchone() == ("simulated",1)
    assert db.execute("SELECT event FROM job_events WHERE job_id='sim1' ORDER BY rowid").fetchall() == [
      ("created",),("claimed",),("simulated",)
    ]
    print("PASS simulated job + two audit events atomic and idempotent")

    assert create("rollback1","campaign003") == [1,1]
    db.execute("""CREATE TRIGGER fail_claim_event BEFORE INSERT ON job_events
    WHEN NEW.event='claimed' BEGIN SELECT RAISE(FAIL,'test injected failure'); END""")
    try:
        simulate(db,"rollback1")
        raise AssertionError("Expected SQLite failure")
    except sqlite3.IntegrityError:
        pass
    assert db.execute("SELECT status,attempts FROM jobs WHERE id='rollback1'").fetchone() == ("queued",0)
    assert db.execute("SELECT event FROM job_events WHERE job_id='rollback1'").fetchall() == [("created",)]
    db.execute("DROP TRIGGER fail_claim_event")
    print("PASS entire transaction rolls back on event failure")

    assert create("race1","campaign004") == [1,1]
    db.close()
    def contender(_):
        with connect(db_path) as conn:
            return simulate(conn,"race1")[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        counts = list(pool.map(contender, range(4)))
    assert sorted(counts) == [0,0,0,1], counts
    with connect(db_path) as conn:
        assert conn.execute("SELECT attempts FROM jobs WHERE id='race1'").fetchone()[0] == 1
        assert conn.execute("SELECT event FROM job_events WHERE job_id='race1' ORDER BY rowid").fetchall() == [
          ("created",),("claimed",),("simulated",)
        ]
    print("PASS 4 concurrent scheduler transactions: exactly one claim")
print("RESULT SQLite atomic 5/5 PASS")
