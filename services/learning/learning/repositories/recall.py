import json
from enum import Enum
from typing import Optional, List, Dict, Tuple, Any
import uuid
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from learning.repositories.db import get_db

class RecallRating(str, Enum):
    AGAIN = "again"
    HARD = "hard"
    GOOD = "good"
    EASY = "easy"

class RecallItemKind(str, Enum):
    CONCEPT = "concept"
    MISTAKE = "mistake"
    INVARIANT = "invariant"

class RecallCardState(str, Enum):
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"

class RecallItemRecord(BaseModel):
    id: str
    owner_id: str
    item_key: str
    title: str
    prompt: str
    answer: str
    kind: RecallItemKind
    competency_key: str
    source_kind: str = "concept"
    source_id: Optional[str] = None
    expected_minutes: int = 5
    state: RecallCardState = RecallCardState.NEW
    step: Optional[int] = 0
    stability: float = 0.0
    difficulty: float = 0.0
    due_at_utc: str
    last_reviewed_at_utc: Optional[str] = None
    review_count: int = 0
    last_rating: Optional[RecallRating] = None
    retrievability: float = 1.0
    created_at_utc: str
    updated_at_utc: str

class ReviewLogRecord(BaseModel):
    id: str
    owner_id: str
    item_id: str
    review_request_id: str
    rating: RecallRating
    reviewed_at_utc: str
    scheduled_days: int
    elapsed_days: int
    last_elapsed_days: int
    stability: float
    difficulty: float
    state: RecallCardState

def _ensure_content_col():
    db = get_db()
    try: db.execute("ALTER TABLE recall_items ADD COLUMN content TEXT")
    except: pass
    try: db.execute("ALTER TABLE review_logs ADD COLUMN content TEXT")
    except: pass

def reset_recall_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM recall_items")
        db.execute("DELETE FROM review_logs")

def create_or_get_recall_item(
    owner_id: str,
    item_key: str,
    title: str,
    prompt: str,
    answer: str,
    competency_key: str,
    kind: RecallItemKind = RecallItemKind.CONCEPT,
    source_kind: str = "concept",
    source_id: Optional[str] = None,
    expected_minutes: int = 5,
    initial_due_utc: Optional[str] = None,
) -> Tuple[RecallItemRecord, bool]:
    _ensure_content_col()
    db = get_db()
    
    with db:
        cursor = db.execute("SELECT content FROM recall_items WHERE owner_id = ? AND competency_key = ?", (owner_id, item_key))
        # Note: mapping item_key to competency_key column for uniqueness logic if needed, but it's safe to just use JSON extraction if I used a generic table.
        # Let's actually use the DB carefully. The UNIQUE constraint in schema.sql is (owner_id, competency_key), so I will store item_key in competency_key column.
        row = cursor.fetchone()
        if row and row["content"]:
            d = json.loads(row["content"])
            return RecallItemRecord(**d), False

        now_iso = datetime.now(timezone.utc).isoformat()
        due_iso = initial_due_utc or now_iso
        item_id = str(uuid.uuid4())
        
        item = RecallItemRecord(
            id=item_id,
            owner_id=owner_id,
            item_key=item_key,
            title=title,
            prompt=prompt,
            answer=answer,
            kind=kind,
            competency_key=competency_key,
            source_kind=source_kind,
            source_id=source_id,
            expected_minutes=expected_minutes,
            state=RecallCardState.NEW,
            step=0,
            stability=0.0,
            difficulty=0.0,
            due_at_utc=due_iso,
            last_reviewed_at_utc=None,
            review_count=0,
            last_rating=None,
            retrievability=1.0,
            created_at_utc=now_iso,
            updated_at_utc=now_iso,
        )
        db.execute(
            "INSERT INTO recall_items (id, owner_id, competency_key, next_review_at, interval_days, ease_factor, history, created_at, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (item_id, owner_id, item_key, due_iso, 0, 0.0, "", now_iso, json.dumps(item.model_dump()))
        )
    return item, True

def get_recall_item(owner_id: str, item_id: str) -> Optional[RecallItemRecord]:
    _ensure_content_col()
    db = get_db()
    cursor = db.execute("SELECT content FROM recall_items WHERE id = ? AND owner_id = ?", (item_id, owner_id))
    row = cursor.fetchone()
    if row and row["content"]:
        return RecallItemRecord(**json.loads(row["content"]))
    return None

def get_recall_item_by_key(owner_id: str, item_key: str) -> Optional[RecallItemRecord]:
    _ensure_content_col()
    db = get_db()
    cursor = db.execute("SELECT content FROM recall_items WHERE owner_id = ? AND competency_key = ?", (owner_id, item_key))
    row = cursor.fetchone()
    if row and row["content"]:
        return RecallItemRecord(**json.loads(row["content"]))
    return None

def list_owner_recall_items(owner_id: str) -> List[RecallItemRecord]:
    _ensure_content_col()
    db = get_db()
    cursor = db.execute("SELECT content FROM recall_items WHERE owner_id = ?", (owner_id,))
    return [RecallItemRecord(**json.loads(row["content"])) for row in cursor if row["content"]]

def record_review_result(
    owner_id: str,
    item_id: str,
    review_request_id: str,
    rating: RecallRating,
    updated_item: RecallItemRecord,
    scheduled_days: int,
    elapsed_days: int,
    last_elapsed_days: int,
    reviewed_at_utc: str,
) -> Tuple[RecallItemRecord, ReviewLogRecord, bool]:
    _ensure_content_col()
    db = get_db()
    
    with db:
        # Check idempotency
        # review_request_id logic: let's query review_logs by review_request_id (not in schema, but we can store it in review_logs table or query JSON)
        cursor = db.execute("SELECT content FROM review_logs WHERE owner_id = ? AND id = ?", (owner_id, review_request_id)) # Wait, I don't have review_request_id column
        # Let's just iterate over owner's review logs. It's safer to add a column or just query by json.
        try: db.execute("ALTER TABLE review_logs ADD COLUMN req_id TEXT")
        except: pass
        
        cursor = db.execute("SELECT content FROM review_logs WHERE owner_id = ? AND req_id = ?", (owner_id, review_request_id))
        existing_log_row = cursor.fetchone()
        if existing_log_row and existing_log_row["content"]:
            existing_log = ReviewLogRecord(**json.loads(existing_log_row["content"]))
            current_item = get_recall_item(owner_id, item_id)
            return current_item, existing_log, False
            
        log_id = str(uuid.uuid4())
        log = ReviewLogRecord(
            id=log_id,
            owner_id=owner_id,
            item_id=item_id,
            review_request_id=review_request_id,
            rating=rating,
            reviewed_at_utc=reviewed_at_utc,
            scheduled_days=scheduled_days,
            elapsed_days=elapsed_days,
            last_elapsed_days=last_elapsed_days,
            stability=updated_item.stability,
            difficulty=updated_item.difficulty,
            state=updated_item.state,
        )
        
        db.execute("UPDATE recall_items SET content = ? WHERE id = ?", (json.dumps(updated_item.model_dump()), item_id))
        
        db.execute(
            "INSERT INTO review_logs (id, owner_id, item_id, score, req_id, content) VALUES (?, ?, ?, ?, ?, ?)",
            (log_id, owner_id, item_id, 0, review_request_id, json.dumps(log.model_dump()))
        )
        
    return updated_item, log, True

def export_recall_state() -> Dict[str, Any]:
    _ensure_content_col()
    db = get_db()
    items = []
    logs = []
    
    cursor = db.execute("SELECT content FROM recall_items")
    for row in cursor:
        if row["content"]: items.append(json.loads(row["content"]))
        
    cursor = db.execute("SELECT content FROM review_logs")
    for row in cursor:
        if row["content"]: logs.append(json.loads(row["content"]))
        
    return {"items": items, "logs": logs}

def import_recall_state(state: Dict[str, Any]) -> None:
    reset_recall_store()
    _ensure_content_col()
    db = get_db()
    with db:
        for item_dict in state.get("items", []):
            item = RecallItemRecord(**item_dict)
            db.execute("INSERT INTO recall_items (id, owner_id, competency_key, next_review_at, interval_days, ease_factor, history, created_at, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (item.id, item.owner_id, item.item_key, item.due_at_utc, 0, 0.0, "", item.created_at_utc, json.dumps(item_dict)))
                       
        for log_dict in state.get("logs", []):
            log = ReviewLogRecord(**log_dict)
            try: db.execute("ALTER TABLE review_logs ADD COLUMN req_id TEXT")
            except: pass
            db.execute("INSERT INTO review_logs (id, owner_id, item_id, score, req_id, content) VALUES (?, ?, ?, ?, ?, ?)",
                       (log.id, log.owner_id, log.item_id, 0, log.review_request_id, json.dumps(log_dict)))
