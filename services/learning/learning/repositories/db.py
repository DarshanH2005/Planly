import sqlite3
import threading
import os
from pathlib import Path
from contextlib import contextmanager

# Keep the runtime database with the service by default, and permit a mounted
# directory in containers.  The previous four-dirname calculation placed the
# database in `services/data`, outside the service volume declared by Compose.
_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR = Path(os.environ.get("PLANLY_DATA_DIR", _SERVICE_ROOT / "data"))
DB_PATH = str(_DATA_DIR / "planly.db")

_local = threading.local()
_schema_initialized = False
_init_lock = threading.Lock()

def _get_connection():
    if not hasattr(_local, "conn") or _local.conn is None:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn

def get_db():
    global _schema_initialized
    if not _schema_initialized:
        with _init_lock:
            if not _schema_initialized:
                init_db()
                _schema_initialized = True
    return _get_connection()

def init_db():
    conn = _get_connection()
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    with conn:
        conn.executescript(schema_sql)
        # SQLite does not add new columns to an existing CREATE TABLE IF NOT EXISTS.
        for statement in (
            "ALTER TABLE sessions ADD COLUMN parent_session_id TEXT",
            "ALTER TABLE sessions ADD COLUMN title TEXT",
        ):
            try:
                conn.execute(statement)
            except sqlite3.OperationalError:
                pass
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)")

def close_db():
    if hasattr(_local, "conn") and _local.conn is not None:
        _local.conn.close()
        _local.conn = None

@contextmanager
def transaction():
    conn = get_db()
    try:
        with conn:
            yield conn
    except Exception:
        raise
