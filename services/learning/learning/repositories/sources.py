import json
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple, Union
import uuid
import hashlib
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SourceDocumentRecord,
    PendingTaskRecord,
    PendingTaskType,
    PendingTaskStatus,
    LearningObservation,
    SourceKind,
    AssistanceLevel,
)
from learning.repositories.db import get_db

class ExtractionIssue(BaseModel):
    line_number: int
    issue_type: str
    description: str

class SourceTurnRecord(BaseModel):
    id: str
    document_id: str
    owner_id: str
    turn_index: int
    speaker: str
    content: str
    has_code: bool = False
    code_blocks: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: Optional[str] = None

class SourceImportResult(BaseModel):
    document_id: str = ""
    owner_id: str = ""
    track: str = ""
    classroom_id: str = ""
    session_id: str = ""
    turn_count: int = 0
    observations_created: int = 0
    pending_tasks_created: int = 0
    is_duplicate: bool = False
    pending_question: Optional[str] = None
    extraction_issues: List[ExtractionIssue] = Field(default_factory=list)
    extraction_quality: str = "clean"

def _ensure_content_cols():
    db = get_db()
    try: db.execute("ALTER TABLE source_turns ADD COLUMN code_blocks TEXT")
    except: pass
    try: db.execute("ALTER TABLE source_turns ADD COLUMN has_code INTEGER")
    except: pass
    try: db.execute("ALTER TABLE source_turns ADD COLUMN speaker TEXT")
    except: pass

def reset_sources_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM source_docs")
        db.execute("DELETE FROM source_docs_raw")
        db.execute("DELETE FROM source_turns")
        db.execute("DELETE FROM pending_tasks")

def compute_content_hash(content: Union[bytes, str]) -> str:
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()

def save_source_document(
    owner_id: str,
    track: str,
    filename: str,
    sha256_hash: str,
    raw_content: str = "",
    turn_count: int = 0,
    extraction_quality: str = "clean",
) -> Tuple[SourceDocumentRecord, bool]:
    db = get_db()
    cursor = db.execute("SELECT * FROM source_docs WHERE owner_id = ? AND sha256_hash = ?", (owner_id, sha256_hash))
    row = cursor.fetchone()
    if row:
        return SourceDocumentRecord(**dict(row)), False

    doc_id = str(uuid.uuid4())
    now_str = datetime.now(timezone.utc).isoformat()
    record = SourceDocumentRecord(
        id=doc_id, owner_id=owner_id, track=track, filename=filename, sha256_hash=sha256_hash,
        turn_count=turn_count, extraction_quality=extraction_quality, created_at=now_str, updated_at=now_str
    )
    
    with db:
        db.execute("INSERT INTO source_docs (id, owner_id, track, filename, sha256_hash, turn_count, extraction_quality, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (doc_id, owner_id, track, filename, sha256_hash, turn_count, extraction_quality, now_str, now_str))
        if raw_content:
            db.execute("INSERT INTO source_docs_raw (id, owner_id, doc_id, raw_content, created_at) VALUES (?, ?, ?, ?, ?)",
                       (str(uuid.uuid4()), owner_id, doc_id, raw_content, now_str))
    return record, True

def store_source_document(
    owner_id: str,
    track: str,
    filename: str,
    sha256_hash: str,
    raw_content: str = "",
    turn_count: int = 0,
    extraction_quality: str = "clean",
) -> Tuple[SourceDocumentRecord, bool]:
    return save_source_document(owner_id, track, filename, sha256_hash, raw_content, turn_count, extraction_quality)

def get_source_document(owner_id: str, track: str) -> Optional[SourceDocumentRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM source_docs WHERE owner_id = ? AND track = ?", (owner_id, track))
    row = cursor.fetchone()
    return SourceDocumentRecord(**dict(row)) if row else None

def get_source_document_by_hash(owner_id: str, sha256_hash: str) -> Optional[SourceDocumentRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM source_docs WHERE owner_id = ? AND sha256_hash = ?", (owner_id, sha256_hash))
    row = cursor.fetchone()
    return SourceDocumentRecord(**dict(row)) if row else None

def get_document_by_hash(owner_id: str, sha256_hash: str) -> Optional[SourceDocumentRecord]:
    return get_source_document_by_hash(owner_id, sha256_hash)

def get_owner_source_documents(owner_id: str) -> List[SourceDocumentRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM source_docs WHERE owner_id = ?", (owner_id,))
    return [SourceDocumentRecord(**dict(row)) for row in cursor]

def store_source_turns(document_id: str, turns: List[Any], owner_id: str = "") -> None:
    _ensure_content_cols()
    db = get_db()
    now_str = datetime.now(timezone.utc).isoformat()
    turn_records = []
    
    with db:
        for t in turns:
            if isinstance(t, SourceTurnRecord):
                rec = t
            else:
                speaker = getattr(t, "speaker", None) or (t.get("speaker") if isinstance(t, dict) else "unknown")
                content = getattr(t, "content", None) or (t.get("content") if isinstance(t, dict) else "")
                turn_index = getattr(t, "turn_index", 0) if hasattr(t, "turn_index") else (t.get("turn_index", 0) if isinstance(t, dict) else 0)
                has_code = getattr(t, "has_code", False) if hasattr(t, "has_code") else (t.get("has_code", False) if isinstance(t, dict) else False)
                code_blocks_raw = getattr(t, "code_blocks", []) if hasattr(t, "code_blocks") else (t.get("code_blocks", []) if isinstance(t, dict) else [])
                cb_list = []
                for cb in code_blocks_raw:
                    if hasattr(cb, "language"):
                        cb_list.append({"language": cb.language, "code": cb.code})
                    elif isinstance(cb, dict):
                        cb_list.append(cb)
                rec = SourceTurnRecord(
                    id=str(uuid.uuid4()), document_id=document_id, owner_id=owner_id, turn_index=turn_index,
                    speaker=speaker, content=content, has_code=has_code, code_blocks=cb_list, created_at=now_str,
                )
            turn_records.append(rec)
            db.execute("INSERT INTO source_turns (id, owner_id, doc_id, turn_index, content, created_at, speaker, has_code, code_blocks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (rec.id, rec.owner_id, rec.document_id, rec.turn_index, rec.content, rec.created_at, rec.speaker, 1 if rec.has_code else 0, json.dumps(rec.code_blocks)))

def get_source_turns(document_id: str) -> List[SourceTurnRecord]:
    _ensure_content_cols()
    db = get_db()
    cursor = db.execute("SELECT * FROM source_turns WHERE doc_id = ? ORDER BY turn_index ASC", (document_id,))
    res = []
    for row in cursor:
        d = dict(row)
        d["document_id"] = d.pop("doc_id")
        d["has_code"] = bool(d.get("has_code", False))
        d["code_blocks"] = json.loads(d.get("code_blocks", "[]"))
        if "speaker" not in d: d["speaker"] = "unknown"
        res.append(SourceTurnRecord(**d))
    return res

def create_or_update_pending_task(
    owner_id: str,
    classroom_id: str,
    session_id: str,
    task_type: PendingTaskType,
    title: str,
    prompt_text: str,
    context_json: Optional[Dict[str, Any]] = None,
) -> Tuple[PendingTaskRecord, bool]:
    db = get_db()
    ctx = context_json or {}
    now_str = datetime.now(timezone.utc).isoformat()
    
    with db:
        cursor = db.execute("SELECT * FROM pending_tasks WHERE owner_id = ? AND classroom_id = ? AND task_type = ? AND title = ?",
                            (owner_id, classroom_id, task_type.value, title))
        row = cursor.fetchone()
        if row:
            db.execute("UPDATE pending_tasks SET prompt_text = ?, context_json = ?, updated_at = ? WHERE id = ?",
                       (prompt_text, json.dumps(ctx), now_str, row["id"]))
            cursor = db.execute("SELECT * FROM pending_tasks WHERE id = ?", (row["id"],))
            d = dict(cursor.fetchone())
            d["context_json"] = json.loads(d["context_json"])
            return PendingTaskRecord(**d), False
            
        task_id = str(uuid.uuid4())
        record = PendingTaskRecord(
            id=task_id, owner_id=owner_id, classroom_id=classroom_id, session_id=session_id, task_type=task_type,
            title=title, prompt_text=prompt_text, context_json=ctx, status=PendingTaskStatus.PENDING, created_at=now_str, updated_at=now_str
        )
        db.execute("INSERT INTO pending_tasks (id, owner_id, classroom_id, session_id, task_type, title, prompt_text, context_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (task_id, owner_id, classroom_id, session_id, task_type.value, title, prompt_text, json.dumps(ctx), PendingTaskStatus.PENDING.value, now_str, now_str))
    return record, True

def get_pending_tasks(
    owner_id: str,
    classroom_id: Optional[str] = None,
    task_type: Optional[PendingTaskType] = None,
    status: Optional[PendingTaskStatus] = None,
) -> List[PendingTaskRecord]:
    db = get_db()
    query = "SELECT * FROM pending_tasks WHERE owner_id = ?"
    params = [owner_id]
    if classroom_id:
        query += " AND classroom_id = ?"
        params.append(classroom_id)
    if task_type:
        query += " AND task_type = ?"
        params.append(task_type.value)
    if status:
        query += " AND status = ?"
        params.append(status.value)
        
    cursor = db.execute(query, params)
    res = []
    for row in cursor:
        d = dict(row)
        d["context_json"] = json.loads(d["context_json"])
        res.append(PendingTaskRecord(**d))
    return sorted(res, key=lambda t: t.created_at or "")

def update_pending_task(
    owner_id: str,
    task_id: str,
    status: Optional[PendingTaskStatus] = None,
    context_json: Optional[Dict[str, Any]] = None,
) -> Optional[PendingTaskRecord]:
    db = get_db()
    now_str = datetime.now(timezone.utc).isoformat()
    clauses = ["updated_at = ?"]
    params: List[Any] = [now_str]
    if status is not None:
        clauses.append("status = ?")
        params.append(status.value)
    if context_json is not None:
        clauses.append("context_json = ?")
        params.append(json.dumps(context_json))
    params.extend([owner_id, task_id])
    with db:
        db.execute(
            f"UPDATE pending_tasks SET {', '.join(clauses)} WHERE owner_id = ? AND id = ?",
            params,
        )
    cursor = db.execute("SELECT * FROM pending_tasks WHERE owner_id = ? AND id = ?", (owner_id, task_id))
    row = cursor.fetchone()
    if not row:
        return None
    d = dict(row)
    d["context_json"] = json.loads(d["context_json"])
    return PendingTaskRecord(**d)

def update_pending_task_status(
    owner_id: str,
    task_id: str,
    status: PendingTaskStatus,
) -> Optional[PendingTaskRecord]:
    return update_pending_task(owner_id, task_id, status=status)

def calculate_measured_readiness(observations: List[LearningObservation]) -> Dict[str, Any]:
    demonstrated_competencies = set()
    guided_or_assisted = set()
    tutor_explanations_count = 0

    for obs in observations:
        if (
            obs.demonstrated is True
            and obs.assistance_level == AssistanceLevel.INDEPENDENT
            and obs.source_kind == SourceKind.LEARNER_WORK
        ):
            demonstrated_competencies.add(obs.competency_key)
        elif obs.assistance_level in (AssistanceLevel.GUIDED, AssistanceLevel.TUTOR_SUPPLIED):
            guided_or_assisted.add(obs.competency_key)

        if obs.source_kind == SourceKind.TUTOR_EXPLANATION:
            tutor_explanations_count += 1

    return {
        "verified_competencies_count": len(demonstrated_competencies),
        "verified_competency_keys": sorted(list(demonstrated_competencies)),
        "guided_or_assisted_count": len(guided_or_assisted),
        "tutor_explanations_count": tutor_explanations_count,
        "unsupported_percentages_ignored": True,
    }
