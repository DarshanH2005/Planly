import json
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from learning.domain.contracts import (
    ExecutionRecord,
    ExecutionStatus,
    TestResult,
)
from learning.repositories.db import get_db

def _ensure_content_col():
    db = get_db()
    try: db.execute("ALTER TABLE executions ADD COLUMN content TEXT")
    except: pass

def reset_executions_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM executions")

def record_execution(
    execution_or_owner_id: Any,
    session_id: Optional[str] = None,
    artifact_revision: Optional[int] = None,
    artifact_hash: Optional[str] = None,
    test_suite_hash: Optional[str] = None,
    status: Optional[ExecutionStatus] = None,
    passed: Optional[bool] = None,
    tests_total: Optional[int] = None,
    tests_passed: Optional[int] = None,
    results: Optional[List[TestResult]] = None,
    artifact_id: Optional[str] = None,
    stdout: str = "",
    stderr: str = "",
    duration_ms: float = 0.0,
    sandbox_provider: str = "subprocess",
    is_stale: bool = False,
    execution_id: Optional[str] = None,
) -> ExecutionRecord:
    _ensure_content_col()
    db = get_db()
    
    if isinstance(execution_or_owner_id, ExecutionRecord):
        rec = execution_or_owner_id
    else:
        exec_id = execution_id or f"exec_{uuid.uuid4().hex[:12]}"
        created_at = datetime.now(timezone.utc).isoformat()
        rec = ExecutionRecord(
            id=exec_id,
            session_id=session_id or "",
            owner_id=str(execution_or_owner_id),
            artifact_id=artifact_id,
            artifact_revision=artifact_revision or 1,
            artifact_hash=artifact_hash or "",
            test_suite_hash=test_suite_hash or "",
            status=status or ExecutionStatus.FAILED,
            passed=passed if passed is not None else False,
            tests_total=tests_total or 0,
            tests_passed=tests_passed or 0,
            results=results or [],
            stdout=stdout,
            stderr=stderr,
            duration_ms=duration_ms,
            sandbox_provider=sandbox_provider,
            is_stale=is_stale,
            created_at=created_at,
        )

    with db:
        db.execute(
            "INSERT INTO executions (id, session_id, owner_id, artifact_id, artifact_revision, artifact_hash, test_suite_hash, status, passed, tests_total, tests_passed, results, stdout, stderr, stdout_truncated, duration_ms, sandbox_provider, is_stale, created_at, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (rec.id, rec.session_id, rec.owner_id, rec.artifact_id, rec.artifact_revision, rec.artifact_hash, rec.test_suite_hash, rec.status.value, 1 if rec.passed else 0, rec.tests_total, rec.tests_passed, json.dumps([r.model_dump() for r in rec.results]), rec.stdout, rec.stderr, 0, rec.duration_ms, rec.sandbox_provider, 1 if rec.is_stale else 0, rec.created_at, json.dumps(rec.model_dump()))
        )

    return rec

def get_execution(owner_id_or_execution_id: str, execution_id: Optional[str] = None) -> Optional[ExecutionRecord]:
    _ensure_content_col()
    db = get_db()
    
    if execution_id is not None:
        owner_id = owner_id_or_execution_id
        target_id = execution_id
        cursor = db.execute("SELECT content FROM executions WHERE id = ? AND owner_id = ?", (target_id, owner_id))
    else:
        target_id = owner_id_or_execution_id
        cursor = db.execute("SELECT content FROM executions WHERE id = ?", (target_id,))
        
    row = cursor.fetchone()
    if row and row["content"]:
        return ExecutionRecord(**json.loads(row["content"]))
    return None

def list_executions_for_session(
    owner_id_or_session_id: str,
    session_id: Optional[str] = None,
    limit: int = 50,
) -> List[ExecutionRecord]:
    _ensure_content_col()
    db = get_db()
    
    if session_id is not None:
        owner_id = owner_id_or_session_id
        target_session = session_id
        cursor = db.execute("SELECT content FROM executions WHERE session_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT ?", (target_session, owner_id, limit))
    else:
        target_session = owner_id_or_session_id
        cursor = db.execute("SELECT content FROM executions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?", (target_session, limit))
        
    res = []
    for row in cursor:
        if row["content"]:
            res.append(ExecutionRecord(**json.loads(row["content"])))
    return res

list_session_executions = list_executions_for_session

def get_latest_execution_for_artifact(
    artifact_id: str,
    revision: Optional[int] = None,
) -> Optional[ExecutionRecord]:
    _ensure_content_col()
    db = get_db()
    
    if revision is None:
        cursor = db.execute("SELECT content FROM executions WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 1", (artifact_id,))
    else:
        cursor = db.execute("SELECT content FROM executions WHERE artifact_id = ? AND artifact_revision = ? ORDER BY created_at DESC LIMIT 1", (artifact_id, revision))
        
    row = cursor.fetchone()
    if row and row["content"]:
        return ExecutionRecord(**json.loads(row["content"]))
    return None

def get_latest_execution(
    owner_id: str,
    session_id: str,
    revision: Optional[int] = None,
) -> Optional[ExecutionRecord]:
    _ensure_content_col()
    db = get_db()
    
    if revision is not None:
        cursor = db.execute("SELECT content FROM executions WHERE owner_id = ? AND session_id = ? AND artifact_revision = ? ORDER BY created_at DESC LIMIT 1", (owner_id, session_id, revision))
    else:
        cursor = db.execute("SELECT content FROM executions WHERE owner_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1", (owner_id, session_id))
        
    row = cursor.fetchone()
    if row and row["content"]:
        return ExecutionRecord(**json.loads(row["content"]))
    return None

def mark_execution_stale(execution_id: str) -> Optional[ExecutionRecord]:
    _ensure_content_col()
    db = get_db()
    
    cursor = db.execute("SELECT content FROM executions WHERE id = ?", (execution_id,))
    row = cursor.fetchone()
    if not row or not row["content"]:
        return None
        
    rec = ExecutionRecord(**json.loads(row["content"]))
    updated = rec.model_copy(update={"is_stale": True})
    
    with db:
        db.execute("UPDATE executions SET content = ?, is_stale = 1 WHERE id = ?", (json.dumps(updated.model_dump()), execution_id))
        
    return updated

def mark_stale_executions_for_session(
    session_id: str,
    current_session_revision: int,
) -> int:
    _ensure_content_col()
    db = get_db()
    updated_count = 0
    
    with db:
        cursor = db.execute("SELECT id, content FROM executions WHERE session_id = ? AND artifact_revision < ? AND is_stale = 0", (session_id, current_session_revision))
        for row in cursor:
            if row["content"]:
                rec = ExecutionRecord(**json.loads(row["content"]))
                updated_rec = rec.model_copy(update={"is_stale": True})
                db.execute("UPDATE executions SET content = ?, is_stale = 1 WHERE id = ?", (json.dumps(updated_rec.model_dump()), row["id"]))
                updated_count += 1
                
    return updated_count
